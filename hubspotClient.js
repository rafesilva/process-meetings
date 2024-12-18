const hubspot = require('@hubspot/api-client');
const hubspotClient = new hubspot.Client({ accessToken: '' });


const getHubSpotClient = () => {
    return hubspotClient
}

const getBatchApi = (meetingId) => {
    return hubspotClient.crm.associations.batchApi.read(
        'meetings', 'contacts', { inputs: [{ id: meetingId }] }
      );
}

module.exports = {getHubSpotClient, getBatchApi}