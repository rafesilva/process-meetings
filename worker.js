const hubspot = require('@hubspot/api-client');
const { queue } = require('async');
const _ = require('lodash');

const { filterNullValuesFromObject, findHubspotAccount, goal, refreshAccessToken, saveDomain, safeExecute } = require('./utils');
const Domain = require('./Domain');

const hubspotClient = new hubspot.Client({ accessToken: '' });
const propertyPrefix = 'hubspot__';
let expirationDate;

const generateLastModifiedDateFilter = (date, nowDate, propertyName = 'hs_lastmodifieddate') => {
  const lastModifiedDateFilter = date ?
    {
      filters: [
        { propertyName, operator: 'GTE', value: `${date.valueOf()}` },
        { propertyName, operator: 'LTE', value: `${nowDate.valueOf()}` }
      ]
    } :
    {};

  return lastModifiedDateFilter;
};


function createSearchFilter(properties, lastModifiedDate, now) {
  return {
    groups: [generateLastModifiedDateFilter(lastModifiedDate, now)],
    sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
    properties,
    limit: 100
  }
}

async function fetchDataWithRetry(type=null,hubspotClient, searchObj, expirationDate, domain, hubId) {
  let searchResult = {};
  let tryCount = 0;

  while (tryCount <= 4) {
    try {
      searchResult = await hubspotClient.crm.objects.searchApi.doSearch(type, searchObj);
      return searchResult;
    } catch {
      tryCount++;
      if (new Date() > expirationDate) await refreshAccessToken(domain, hubId, hubspotClient);
      await new Promise(resolve => setTimeout(resolve, 5000 * Math.pow(2, tryCount)));
    }
  }

  throw new Error(`Failed to fetch ${type} after 4 attempts. Aborting.`);
}

/**
 * Get recently modified companies as 100 companies per page
 */
const processCompanies = async (domain, hubId, q) => {
  const account = findHubspotAccount(domain, hubId);
  const lastPulledDate = new Date(account.lastPulledDates.companies);
  const now = new Date();

  let hasMore = true;
  const offsetObject = {};
  // const limit = 100;

  while (hasMore) {
    const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
    const properties = [
      'name',
      'domain',
      'country',
      'industry',
      'description',
      'annualrevenue',
      'numberofemployees',
      'hs_lead_status'
    ]
    const searchObject = createSearchFilter(properties, lastModifiedDate, now)
    searchObject.after = offsetObject.after

    let searchResult = fetchDataWithRetry('companies', hubspotClient, searchObject, expirationDate, domain, hubId)

    const data = searchResult?.results || [];
    offsetObject.after = parseInt(searchResult?.paging?.next?.after);

    console.log('fetch company batch');

    data.forEach(company => {
      if (!company.properties) return;

      const actionTemplate = {
        includeInAnalytics: 0,
        companyProperties: {
          company_id: company.id,
          company_domain: company.properties.domain,
          company_industry: company.properties.industry
        }
      };

      const isCreated = !lastPulledDate || (new Date(company.createdAt) > lastPulledDate);

      q.push({
        actionName: isCreated ? 'Company Created' : 'Company Updated',
        actionDate: new Date(isCreated ? company.createdAt : company.updatedAt) - 2000,
        ...actionTemplate
      });
    });

    if (!offsetObject?.after) {
      hasMore = false;
      break;
    } else if (offsetObject?.after >= 9900) {
      offsetObject.after = 0;
      offsetObject.lastModifiedDate = new Date(data[data.length - 1].updatedAt).valueOf();
    }
  }

  account.lastPulledDates.companies = now;
  await saveDomain(domain);

  return true;
};

/**
 * Get recently modified contacts as 100 contacts per page
 */
const processContacts = async (domain, hubId, q) => {
  const account = findHubspotAccount(domain, hubId);
  const lastPulledDate = new Date(account.lastPulledDates.contacts);
  const now = new Date();

  let hasMore = true;
  const offsetObject = {};
  // const limit = 100;

  while (hasMore) {
    const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
    const  properties = [
      'firstname',
      'lastname',
      'jobtitle',
      'email',
      'hubspotscore',
      'hs_lead_status',
      'hs_analytics_source',
      'hs_latest_source'
    ]

    const searchObject = createSearchFilter(properties, lastModifiedDate, now)
    searchObject.after = offsetObject.after

    let searchResult = fetchDataWithRetry('contacts',hubspotClient, searchObject, expirationDate, domain, hubId)

    const data = searchResult.results || [];

    console.log('fetch contact batch');

    offsetObject.after = parseInt(searchResult.paging?.next?.after);
    const contactIds = data.map(contact => contact.id);

    // contact to company association
    const contactsToAssociate = contactIds;
    const companyAssociationsResults = (await (await hubspotClient.apiRequest({
      method: 'post',
      path: '/crm/v3/associations/CONTACTS/COMPANIES/batch/read',
      body: { inputs: contactsToAssociate.map(contactId => ({ id: contactId })) }
    })).json())?.results || [];

    const companyAssociations = Object.fromEntries(companyAssociationsResults.map(a => {
      if (a.from) {
        contactsToAssociate.splice(contactsToAssociate.indexOf(a.from.id), 1);
        return [a.from.id, a.to[0].id];
      } else return false;
    }).filter(x => x));

    data.forEach(contact => {
      if (!contact.properties || !contact.properties.email) return;

      const companyId = companyAssociations[contact.id];

      const isCreated = new Date(contact.createdAt) > lastPulledDate;

      const userProperties = {
        company_id: companyId,
        contact_name: ((contact.properties.firstname || '') + ' ' + (contact.properties.lastname || '')).trim(),
        contact_title: contact.properties.jobtitle,
        contact_source: contact.properties.hs_analytics_source,
        contact_status: contact.properties.hs_lead_status,
        contact_score: parseInt(contact.properties.hubspotscore) || 0
      };

      const actionTemplate = {
        includeInAnalytics: 0,
        identity: contact.properties.email,
        userProperties: filterNullValuesFromObject(userProperties)
      };

      q.push({
        actionName: isCreated ? 'Contact Created' : 'Contact Updated',
        actionDate: new Date(isCreated ? contact.createdAt : contact.updatedAt),
        ...actionTemplate
      });
    });

    if (!offsetObject?.after) {
      hasMore = false;
      break;
    } else if (offsetObject?.after >= 9900) {
      offsetObject.after = 0;
      offsetObject.lastModifiedDate = new Date(data[data.length - 1].updatedAt).valueOf();
    }
  }

  account.lastPulledDates.contacts = now;
  await saveDomain(domain);

  return true;
};

/**
 * Get recently modified meetings as 100 meetings per page
 */
const processMeetings = async (domain, hubId, q) => {
  const account = domain.integrations.hubspot.accounts.find(account => account.hubId === hubId)

  // console.log('process meetings account', account)

  const lastPulledDate = new Date(account.lastPulledDates.meetings || 0)
  const now = new Date()
  let notEmpty = true
  const offset = {}

  while (notEmpty) {
    const lastModifiedDate = offset.lastModifiedDate || lastPulledDate;
    const properties = ['hs_meeting_title', 'createdAt', 'updatedAt']
    const searchObject = createSearchFilter(properties, lastModifiedDate, now)
    searchObject.after = offset.after

    let searchResult = fetchDataWithRetry('meetings',hubspotClient, searchObject, expirationDate, domain, hubId)
    
    const data = searchResult.results || []
    offset.after = parseInt(searchResult.paging?.next.after)

    console.log('meeting batch')

    data.forEach( async meeting => {
      if (!meeting.properties) return;

      const meetingId = meeting.id;
      let contactAssociationsResult;

      try {
        contactAssociationsResult = await hubspotClient.crm.associations.batchApi.read(
          'meetings', 'contacts', { inputs: [{ id: meetingId }] }
        );
      } catch (err) {
        console.error(`Error fetching associations for meeting ${meetingId}:`, err);
        return;
      }

      const associatedContacts = contactAssociationsResult.results?.flatMap(association => {
        return association.to ? association.to.map(contact => contact.id) : [];
      }) || [];

      associatedContacts.forEach( async contactId=> {
        let contactDetails;
        try {
          contactDetails = await hubspotClient.crm.contacts.basicApi.getById(contactId, ['email']);
        } catch (err) {
          console.error(`Error fetching details for contact ${contactId}:`, err);
          return;
        }

        const contactEmail = contactDetails?.properties?.email || 'Unknown';

        const isCreated = new Date(meeting.properties.createdAt) > lastPulledDate;

        const actionTemplate = {
          includeInAnalytics: 0,
          meetingProperties: {
            meeting_id: meeting.id,
            meeting_title: meeting.properties.hs_meeting_title,
            contact_email: contactEmail
          }
        };

        q.push({
          actionName: isCreated ? 'Meeting Created' : 'Meeting Updated',
          actionDate: new Date(isCreated ? meeting.properties.createdAt : meeting.properties.updatedAt),
          ...actionTemplate
        });
      })
    })

    if (!offset?.after) {
      notEmpty = false
      break
    } else if (offset?.after >= 9900) {
      offset.after = 0;
      offset.lastModifiedDate = new Date(data[data.length - 1].updatedAt).valueOf();
    }
  }

  account.lastPulledDates.meetings = now;
  await saveDomain(domain);

  return true;

}

const createQueue = (domain, actions) => queue(async (action, callback) => {
  actions.push(action);

  if (actions.length > 2000) {
    console.log('inserting actions to database', { apiKey: domain.apiKey, count: actions.length });

    const copyOfActions = _.cloneDeep(actions);
    actions.splice(0, actions.length);

    goal(copyOfActions);
  }

  callback();
}, 100000000);

const drainQueue = async (domain, actions, q) => {
  if (q.length() > 0) await q.drain();

  if (actions.length > 0) {
    goal(actions)
  }

  return true;
};

const pullDataFromHubspot = async () => {
  console.log('start pulling data from HubSpot');

  const domain = await Domain.findOne({});

  for (const account of domain.integrations.hubspot.accounts) {
    console.log('start processing account');

    await safeExecute('refreshAccessToken', async () => {
      await refreshAccessToken(domain, account.hubId, hubspotClient);
    }, { apiKey: domain.apiKey, hubId: account.hubId });

    const actions = [];
    const actionQueue = createQueue(domain, actions);

    [processContacts,processCompanies,processMeetings,drainQueue].forEach( async fn => {
      await safeExecute([fn], async () => {
        await fn(domain, account.hubId, actionQueue);
      }, { apiKey: domain.apiKey, hubId: account.hubId });
    })
   
    await saveDomain(domain);

    console.log('finish processing account');
  }

  process.exit();
};

module.exports = pullDataFromHubspot;
