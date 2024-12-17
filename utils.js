const NodeCache = require('node-cache');
const tokenCache = new NodeCache({ stdTTL: 3500 });


const disallowedValues = [
  '[not provided]',
  'placeholder',
  '[[unknown]]',
  'not set',
  'not provided',
  'unknown',
  'undefined',
  'n/a'
];


function findHubspotAccount(domain, hubId) {
  return domain.integrations.hubspot.accounts.find(account => account.hubId === hubId);
}

/**
 * Get access token from HubSpot
 */
const refreshAccessToken = async (domain, hubId, hubspotClient) => {
  console.log('refreshing access token')
  const { HUBSPOT_CID, HUBSPOT_CS } = process.env;
  const account = findHubspotAccount(domain, hubId);

  const cachedToken = tokenCache.get(`accessToken_${hubId}`);
  console.log('token cached')
  if (cachedToken) {
    console.log('Using cached access token');
    hubspotClient.setAccessToken(cachedToken);
    return true;
  }

  const { refreshToken } = account;
  const result = await hubspotClient.oauth.tokensApi.createToken(
    'refresh_token', undefined, undefined, HUBSPOT_CID, HUBSPOT_CS, refreshToken
  );
  console.log('refreshed token')
  const newAccessToken = result.accessToken;
  expirationDate = new Date(result.expiresIn * 1000 + Date.now());

  tokenCache.set(`accessToken_${hubId}`, newAccessToken);
  // console.log('set access token cache', tokenCache)

  hubspotClient.setAccessToken(newAccessToken);

  account.accessToken = newAccessToken;
  return true;
};

const saveDomain = async domain => {
  // disable this for testing purposes
  return;

  domain.markModified('integrations.hubspot.accounts');
  await domain.save();
};


const safeExecute = async (operationName, fn, metadata = {}) => {
  try {
    return await fn();
  } catch (err) {
    console.error(`Error in operation: ${operationName}`, { error: err.message, metadata });
    throw err;
  }
};

const filterNullValuesFromObject = object =>
  Object
    .fromEntries(
      Object
        .entries(object)
        .filter(([_, v]) =>
          v !== null &&
          v !== '' &&
          typeof v !== 'undefined' &&
          (typeof v !== 'string' || !disallowedValues.includes(v.toLowerCase()) || !v.toLowerCase().includes('!$record'))));

const normalizePropertyName = key => key.toLowerCase().replace(/__c$/, '').replace(/^_+|_+$/g, '').replace(/_+/g, '_');

const goal = actions => {
  // this is where the data will be written to the database
  console.log(actions);
};

module.exports = {
  filterNullValuesFromObject,
  findHubspotAccount,
  normalizePropertyName,
  goal,
  refreshAccessToken,
  saveDomain,
  safeExecute
};
