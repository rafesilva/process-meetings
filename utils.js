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
  normalizePropertyName,
  goal,
  safeExecute
};
