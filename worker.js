const _ = require('lodash');
const { queue } = require('async');

const { getContactDetails, getContactAssociationsResult, createAction, createSearchFilter, fetchDataWithRetry, filterNullValuesFromObject, findHubspotAccount, goal, refreshAccessToken, saveDomain, safeExecute, updatePaginationState } = require('./utils');
const Domain = require('./Domain');

const propertyPrefix = 'hubspot__';
const {getHubSpotClient} = require('./hubspotClient')
const hubspotClient = getHubSpotClient()

/**
 * Get recently modified companies as 100 companies per page
 */
const processCompanies = async (domain, hubId, q, expirationDate) => {
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

    let searchResult = await fetchDataWithRetry('companies', hubspotClient, searchObject, expirationDate, domain, hubId)
    // console.log(' searchResult', searchResult)

    const data = searchResult?.results || [];
    console.log('data', data)
    offsetObject.after = parseInt(searchResult?.paging?.next?.after) || 0;

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

      q.push(createAction(
        company, 
        actionTemplate,
        lastPulledDate
      ));
    });
    // hasMore = !!offsetObject.after
    console.log('offsetObject', offsetObject)
    hasMore = updatePaginationState(offsetObject, data);
    console.log('hasMore', hasMore)
  }

  account.lastPulledDates.companies = now;
  await saveDomain(domain);

  return true;
};

/**
 * Get recently modified contacts as 100 contacts per page
 */
const processContacts = async (domain, hubId, q, expirationDate) => {
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

    let searchResult = await fetchDataWithRetry('contacts', hubspotClient, searchObject, expirationDate, domain, hubId)
    
    console.log('searchResult contacts', searchResult)
    
    const data = searchResult.results || [];

    console.log('data', data)
    console.log('fetch contact batch');

    offsetObject.after = parseInt(searchResult?.paging?.next?.after) || 0;
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
      q.push(createAction(
        contact, 
        actionTemplate,
        lastPulledDate
      ));
    });

    hasMore = updatePaginationState(offsetObject, data);
    console.log('hasMore contacts', hasMore)
  }

  account.lastPulledDates.contacts = now;
  await saveDomain(domain);

  return true;
};

/**
 * Get recently modified meetings as 100 meetings per page
 */
const processMeetings = async (domain, hubId, q, expirationDate) => {
  const account = findHubspotAccount(domain, hubId);

  // console.log('process meetings account', account)

  const lastPulledDate = new Date(account.lastPulledDates.meetings)
  const now = new Date()
  let hasMore = true
  const offsetObject = {}

  while (hasMore) {
    const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
    const properties = ['hs_meeting_title', 'createdAt', 'updatedAt']
    const searchObject = createSearchFilter(properties, lastModifiedDate, now)
    searchObject.after = offsetObject.after

    let searchResult = await fetchDataWithRetry('meetings', hubspotClient, searchObject, expirationDate, domain, hubId)
    const data = searchResult.results || []
    offsetObject.after = parseInt(searchResult?.paging?.next?.after) || 0;

    console.log('meeting batch')

    data.forEach( async meeting => {
      if (!meeting.properties) return;

      const meetingId = meeting.id;

      let contactAssociationsResult = await getContactAssociationsResult(meetingId, hubspotClient)
      
      
      const associatedContacts = contactAssociationsResult.results?.flatMap(association => {
        return association.to ? association.to.map(contact => contact.id) : [];
      }) || [];

      
      associatedContacts.forEach( async contactId=> {
        let contactDetails = await getContactDetails(contactId, hubspotClient)
       
        const contactEmail = contactDetails?.properties?.email || 'Unknown';

        const actionTemplate = {
          includeInAnalytics: 0,
          meetingProperties: {
            meeting_id: meeting.id,
            meeting_title: meeting.properties.hs_meeting_title,
            contact_email: contactEmail
          }
        };

        q.push(createAction(
          meeting, 
          actionTemplate,
          lastPulledDate
        ));
      })
    })

    hasMore = updatePaginationState(offsetObject, data);
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

    // await safeExecute('refreshAccessToken', async () => {
    const [isAuth, expirationDate] = await refreshAccessToken(domain, account.hubId, hubspotClient);
    // }, { apiKey: domain.apiKey, hubId: account.hubId });

    const actions = [];
    const actionQueue = createQueue(domain, actions);

    [processContacts,processCompanies,processMeetings,drainQueue].forEach( async fn => {
      await safeExecute([fn], async () => {
        await fn(domain, account.hubId, actionQueue, expirationDate);
      }, { apiKey: domain.apiKey, hubId: account.hubId });
    })
   
    await saveDomain(domain);

    console.log('finish processing account');
  }

  process.exit();
};

module.exports = {
  processCompanies,
  processContacts,
  processMeetings,
  pullDataFromHubspot
}
