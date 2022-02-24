const sql = require('mssql');             // SQL Server
const fetch = require('node-fetch');      // HTTP requests for REST API calls
const storage = require('azure-storage'); // Azure storage SDK
const path = require('path');

// Import required Bot Builder
const { ComponentDialog, WaterfallDialog, TextPrompt, ChoicePrompt } = require('botbuilder-dialogs');
const { ActivityTypes, CardFactory } = require('botbuilder');

// Analysis state for analysis dialog
const { AnalysisProfile } = require('./analysisProfile');

// Minimum length requirements
const DATA_SOURCE_LENGTH_MIN = 5;

// Dialog IDs
const ANALYSIS_DIALOG = 'analysisDialog';

// Prompt IDs
const DATA_SOURCE_PROMPT = 'dataSourcePrompt';
const TIME_PERIOD_PROMPT = 'timePeriodPrompt';

const VALIDATION_SUCCEEDED = true;
const VALIDATION_FAILED = !VALIDATION_SUCCEEDED;
const AVAILABLE_DATA_SOURCES = ['Occupancy Data', 'Check-in Data'];

/**
 * The Analysis class represents a conversational dialog with a user to query/analyze some data
 *
 * @param {String} dialogId unique identifier for this dialog instance
 * @param {PropertyStateAccessor} analysisStateAccessor property accessor for user state
 */
class Analysis extends ComponentDialog {
    constructor(dialogId, analysisStateAccessor) {
        super(dialogId);

        // validate what was passed in
        if (!dialogId) throw ('Missing parameter.  dialogId is required');
        if (!analysisStateAccessor) throw ('Missing parameter.  analysisStateAccessor is required');

        // Add a water fall dialog with 4 steps.
        // The order of step function registration is important
        // as a water fall dialog executes steps registered in order
        this.addDialog(new WaterfallDialog(ANALYSIS_DIALOG, [
            this.initializeStateStep.bind(this),
            this.promptForDataSourceStep.bind(this),
            this.promptForTimePeriodStep.bind(this),
            this.displayGreetingStep.bind(this)
        ]));

        // Add text prompts for name and city
        this.addDialog(new ChoicePrompt(DATA_SOURCE_PROMPT, this.validateDataSource));
        this.addDialog(new TextPrompt(TIME_PERIOD_PROMPT, this.validateTimePeriod));

        // Save off our state accessor for later use
        this.analysisStateAccessor = analysisStateAccessor;
    }
    /**
     * Waterfall Dialog step functions.
     *
     * Initialize our state.  See if the WaterfallDialog has state pass to it
     * If not, then just new up an empty AnalysisProfile object
     *
     * @param {WaterfallStepContext} step contextual information for the current step being executed
     */
    async initializeStateStep(step) {
        let analysisProfile = await this.analysisStateAccessor.get(step.context);
        if (analysisProfile === undefined) {
            if (step.options && step.options.analysisProfile) {
                await this.analysisStateAccessor.set(step.context, step.options.analysisProfile);
            } else {
                await this.analysisStateAccessor.set(step.context, new AnalysisProfile());
            }
        }
        return await step.next();
    }

    analysisProfileComplete() {

        const analysisProfile = this.analysisStateAccessor;

        return (
            analysisProfile !== undefined &&
            analysisProfile.dataSource !== undefined &&
            analysisProfile.timeFrame !== undefined &&
            analysisProfile.fields !== undefined
        );
    }

    /**
     * Waterfall Dialog step functions.
     *
     * Using a text prompt, prompt the user for the data source they are interested in.
     * Only prompt if we don't have this information already.
     *
     * @param {WaterfallStepContext} step contextual information for the current step being executed
     */
    async promptForDataSourceStep(step) {
        const analysisProfile = await this.analysisStateAccessor.get(step.context);

        // if we have everything we need, greet user and return
        if (this.analysisProfileComplete()) {
            return await this.greetUser(step);
        }
        if (!analysisProfile.dataSource) {
            // prompt for data source name, if missing

            const promptOptions = {
                prompt: `What data source would you like to analyze?`,
                reprompt: 'That was not a valid choice, please select from the available options.',
                choices: AVAILABLE_DATA_SOURCES
            };
            return await step.prompt(DATA_SOURCE_PROMPT, promptOptions);
        } else {
            return await step.next();
        }
    }
    /**
     * Waterfall Dialog step functions.
     *
     * Using a text prompt, prompt the user for the reporting time period.
     * Only prompt if we don't have this information already.
     *
     * @param {WaterfallStepContext} step contextual information for the current step being executed
     */
    async promptForTimePeriodStep(step) {

        // save name, if prompted for
        const analysisProfile = await this.analysisStateAccessor.get(step.context);

        if (analysisProfile.dataSource === undefined && step.result) {

            analysisProfile.dataSource = step.result.value;
            await this.analysisStateAccessor.set(step.context, analysisProfile);
        }
        if (!analysisProfile.timePeriod) {
            return await step.prompt(TIME_PERIOD_PROMPT, `What time period do you want to see for the ${ analysisProfile.dataSource } data source?`);
        } else {
            return await step.next();
        }
    }
    /**
     * Waterfall Dialog step functions.
     *
     * Having all the data we need, simply display a summary back to the user.
     *
     * @param {WaterfallStepContext} step contextual information for the current step being executed
     */
    async displayGreetingStep(step) {

        // Save city, if prompted for
        const analysisProfile = await this.analysisStateAccessor.get(step.context);

        if (analysisProfile.timePeriod === undefined && step.result) {
            analysisProfile.timePeriod = step.result;
            await this.analysisStateAccessor.set(step.context, analysisProfile);
        }
        return await this.greetUser(step);
    }
    /**
     * Validator function to verify that the data source meets required constraints.
     *
     * @param {validatorContext} validation context for this validator.
     */
    async validateDataSource(validatorContext) {


        const dataSourceValue = validatorContext.recognized.value.value ;

        if (AVAILABLE_DATA_SOURCES.includes(dataSourceValue)) {
            return VALIDATION_SUCCEEDED;
        } else {
            await validatorContext.context.sendActivity(`Data source must be one of the following: ${ AVAILABLE_DATA_SOURCES.join(', ') }`);
            return VALIDATION_FAILED;
        }
    }
    /**
     * Validator function to verify if the analysis time period meets required constraints.
     *
     * @param {PromptValidatorContext} validation context for this validator.
     */
    async validateTimePeriod(validatorContext) {

        // Validate that the user entered a minimum length for their name
        const value = (validatorContext.recognized.value || '').trim();

        if (value.length >= DATA_SOURCE_LENGTH_MIN) {
            return VALIDATION_SUCCEEDED;
        } else {
            await validatorContext.context.sendActivity(`City names needs to be at least ${ DATA_SOURCE_LENGTH_MIN } characters long.`);
            return VALIDATION_FAILED;
        }
    }

    /**
     * Helper function to greet user with information in greetingState.
     *
     * @param {WaterfallStepContext} step contextual information for the current step being executed
     */

    async greetUser(step) {
        const analysisProfile = await this.analysisStateAccessor.get(step.context);

        // Display to the user their analysis information
        await step.context.sendActivity(`Analysis for the ${ analysisProfile.dataSource } for the period ${ analysisProfile.timePeriod }.`);

        // Make a database call
        try {
            const connectionString = `mssql://${process.env.dbUser}:${encodeURI(process.env.dbPassword)}@${process.env.dbServer}/${process.env.dbName}?encrypt=true`;
            await sql.connect(connectionString);
            const result = await sql.query`select * from Persons;`;
            console.log('====> Got SQL data');

            const row = result.recordsets[0][0];

            let data = '';
            data += `FirstName: ${row.FirstName}\n`;
            data += `LastName : ${row.LastName}\n`;
            data += `Address  : ${row.Address}\n`;
            await step.context.sendActivity(`SQL Data:\n ${ data }`);
            console.log('====> Sent SQL data');
            sql.close();

        } catch (err) {
            console.log('[SQL ERROR]: ' + err)
        }

        // Make a REST API call
        try {
            const url = 'https://jsonplaceholder.typicode.com/todos/1';
            const response = await fetch(url);
            console.log('====> Got API data');
            const json = await response.json();
            const apiData = ` userId: ${json.userId}\n title: ${json.title}`;
            await step.context.sendActivity(`API Data:\n ${ apiData }`);
        } catch (err) {
            console.log('[API ERROR]: ' + err)
        }

        // Get file data from Azure Blob Storage
        const blobName = process.env.dataFileName;
        const blobService = storage.createBlobService();
        const dowloadFilePath = path.resolve('./' + blobName.replace('.csv', '.downloaded.csv'));


        const downloadBlob = async (containerName, blobName) => {
            const dowloadFilePath = path.resolve('./' + blobName.replace('.txt', '.downloaded.txt'));
            return new Promise((resolve, reject) => {
                blobService.getBlobToText(containerName, blobName, (err, data) => {
                    console.log('====> Got blob data');
                    if (err) {
                        reject(err);
                    } else {
                        console.log(`====> Got blob data: ${data}`);
                        resolve({ message: `Blob downloaded "${data}"`, text: data });
                        return data;
                    }
                });
            });
        };
        const blobData = await downloadBlob(process.env.containerName, process.env.dataFileName);
        const rows = blobData.text.replace('\r', '').split('\n');
        const columns = rows[0].split(',');

        let dataString = '';
        for (let r=1; r <= 2; r++) {
            const row = rows[r].split(',');

            for (let c=0; c < columns.length; c++) {
                dataString += columns[c] + ': ' + row[c] + '\n'
            }


            if (r < 2) {
                dataString += '\n------\n';
            }
        }
        dataString = dataString.replace('\r', '');
        dataString += '\n';

        console.log(`Unpacked data:\n${dataString}`);
        await step.context.sendActivity(`Blob File Data:\n ${ dataString }`);

        // End dialog
        console.log('+++++> Closing dialog');
        await this.analysisStateAccessor.set(step.context, {});
        return await step.endDialog();

    }
}

exports.AnalysisDialog = Analysis;
