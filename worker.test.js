const { processCompanies, processContacts, processMeetings } = require('./worker');
const {
  getContactDetails,
  getContactAssociationsResult,
  findHubspotAccount,
  createSearchFilter,
  fetchDataWithRetry,
  saveDomain,
  createAction,
  updatePaginationState,
} = require('./utils');

jest.mock('./utils');

describe('HubSpot Data Processing', () => {
  let mockDomain, mockAccount, mockHubId, mockQueue;
  const fixedDate = new Date('2024-06-01T00:00:00Z'); 

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(fixedDate); 
  });

  afterAll(() => {
    jest.useRealTimers(); 
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockDomain = {
      integrations: {
        hubspot: {
          accounts: [
            { hubId: '1234', lastPulledDates: { companies: fixedDate, contacts: fixedDate, meetings: fixedDate } },
          ],
        },
      },
    };
    mockAccount = mockDomain.integrations.hubspot.accounts[0]
    mockHubId = '1234';
    mockQueue = { push: jest.fn() };

    findHubspotAccount.mockReturnValue({
      lastPulledDates: { companies: fixedDate, contacts: fixedDate, meetings: fixedDate },
    });

    createSearchFilter.mockImplementation((properties, lastModifiedDate) => ({
      groups: [{ filters: [{ propertyName: 'hs_lastmodifieddate', operator: 'GT', value: lastModifiedDate }] }],
      properties,
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
      limit: 100,
    }));

    let callCount = 0;

    fetchDataWithRetry.mockImplementation((type, searchObject) => {
      if (!searchObject.after) searchObject.after = 0;

      if (callCount < 2) { 
        callCount++;
        return Promise.resolve({
          results: [
            { id: `${type}-${callCount}`, properties: { email: `user${callCount}@example.com`, hs_meeting_title: `Meeting ${callCount}` } }
          ],
          paging: { next: { after: searchObject.after + 1 } },
        });
      }

      return Promise.resolve({
        results: [],
        paging: { next: null }, 
      });
    });

    getContactAssociationsResult.mockImplementation(() => {
        return {
            results: [{ to: [{ id: 'contact-1' }, { id: 'contact-2' }] }],
          }
    })

    getContactDetails.mockImplementation((id) => {
        return Promise.resolve({ properties: { email: `${id}@example.com` } });
    })

    updatePaginationState.mockImplementation((offsetObject, data) => {
      if (!data.length || offsetObject.after === null) return false;
      return true;
    });

    saveDomain.mockResolvedValue(true);

    createAction.mockImplementation((item) => ({
      actionName: `${item.id} Created`,
      actionDate: fixedDate.getTime(),
    }));
  });

  it('should process companies and push actions to the queue', async () => {
    await processCompanies('companies', mockDomain, mockAccount, mockHubId, mockQueue, fixedDate);

    expect(fetchDataWithRetry).toHaveBeenCalledTimes(3);
    expect(mockQueue.push).toHaveBeenCalledTimes(2);
    expect(saveDomain).toHaveBeenCalledWith(mockDomain);
  });

  it('should process contacts and push actions to the queue', async () => {
    await processContacts('contacts', mockDomain, mockAccount, mockHubId, mockQueue, fixedDate);

    expect(fetchDataWithRetry).toHaveBeenCalledTimes(3);
    expect(mockQueue.push).toHaveBeenCalledTimes(2);
    expect(saveDomain).toHaveBeenCalledWith(mockDomain);
  });

  it('should process meetings and push actions to the queue', async () => {
    await processMeetings('meetings', mockDomain, mockAccount, mockHubId, mockQueue, fixedDate);

    expect(fetchDataWithRetry).toHaveBeenCalledTimes(3);
    expect(mockQueue.push).toHaveBeenCalledTimes(4);
    // expect(mockQueue.push).toHaveBeenCalledWith(
    //   expect.objectContaining({ actionName: expect.stringContaining('Meeting') })
    // );
    expect(saveDomain).toHaveBeenCalledWith(mockDomain);
  });
});
