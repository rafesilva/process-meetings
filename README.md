# API Sample Test

<<<<<<< HEAD
## How to Improve This Project

Add clear comments and simple explanations throughout the code to make it easier for new developers to understand.

Break large blocks of code into smaller, reusable functions like fetching meetings and handling associations. This keeps the code cleaner and more manageable.

Use more human readable variable names; for instance, rename q to something like actionQueue to better convey its purpose.

Separate HubSpot API logic into its own module or service file. This would make the main function focused and easier to test.

Create utility functions for repeated patterns, like retry logic or error handling, to avoid duplication and make updates easier.

Fetch contact details and associations in batches instead of one by one to reduce API calls and speed up processing.

Use caching for frequent lookups, like contact details, to avoid unnecessary calls to HubSpot.

Implement a rate-limiting mechanism to respect HubSpot’s API limits and prevent errors from too many requests at once
=======
## Getting Started

This project requires a newer version of Node. Don't forget to install the NPM packages afterwards.

You should change the name of the ```.env.example``` file to ```.env```.

Run ```node app.js``` to get things started. Hopefully the project should start without any errors.

## Explanations

The actual task will be explained separately.

This is a very simple project that pulls data from HubSpot's CRM API. It pulls and processes company and contact data from HubSpot but does not insert it into the database.

In HubSpot, contacts can be part of companies. HubSpot calls this relationship an association. That is, a contact has an association with a company. We make a separate call when processing contacts to fetch this association data.

The Domain model is a record signifying a HockeyStack customer. You shouldn't worry about the actual implementation of it. The only important property is the ```hubspot```object in ```integrations```. This is how we know which HubSpot instance to connect to.

The implementation of the server and the ```server.js``` is not important for this project.

Every data source in this project was created for test purposes. If any request takes more than 5 seconds to execute, there is something wrong with the implementation.
>>>>>>> c6a48f2 (Improved .gitignore)

