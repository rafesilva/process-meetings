const hubspot = require('@hubspot/api-client');
const hubspotClient = new hubspot.Client({ accessToken: '' });


const getHubSpotClient = () => {
    return hubspotClient
}

const getBatchApi = () => {
    return hubspotClient.crm.associations.batchApi
}

module.exports = {getHubSpotClient, getBatchApi}