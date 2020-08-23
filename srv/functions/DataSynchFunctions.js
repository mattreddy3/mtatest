"use-strict";
// This file contains all functions that are relevant for Synching Data

//	IMPORTS
const cds = require("@sap/cds")
const {
	getDataFromERP,
	postDataToERP
} = require("./ERPFunctions")

const {
	getTenantID,
	deepClone,
	getEntityNameFromTarget
} = require("../utils/hookUtils")

const {
	redfigError,
	errorHandleAddThrow,
	errorHandleAdd,
	stringfy
} = require("../utils/redfigError")

//	CONSTANTS
const mainService = "SynchService" //Main Service (Other than DB)

//	DEBUG HELPER
var dbHelperField

//----------------------------------------------------------------------------------------------------------------
//	"PUBLIC" FUNCTIONS - Functions that are available outside of this file
//----------------------------------------------------------------------------------------------------------------

//	DATA SYNCH MASTER
const dataSynchMaster = async (req) => {
	//	This function processes all data synchronisation between this application and a backend ERP

	//	This simple checks if we are re-calling this function again by looking at the req.method
	if (req.method === undefined || req.method == !"POST") {
		console.log("WARNING: Infinte Loop Being Hit")
	}

	//	Bootstrap DB services
	await bootstrapDBServices(req)

	//	This function has two main steps:
	//		STEP 1: Agrregate Log	-	Add "pending" entries to the Log table for processing
	//		STEP 2: Process Log		-	Process all "pending" entries from the Log Table
	//									AND all entries in status 'E' (automatic reprocessing)
	//	The only errors that are returned to the Client are "Fatal" or programming errors
	//	Errors from individual update calls are simpled marked on the log table with status 'E'
	//		but are not returned to the client as an HTTP error
	//		EX:	if a Notification fails to update in ECC, the corresponding Log Entry will be marked as an error
	//			but the HTTP response to the client will still be successfull 200	

	//	Check if this job is already running
	try {
		const job = await startJob(req)
	} catch (error) {
		return req.reject(500, "Job Already Running") //TODO - Why doesn't this return on the payload
	}

	//	If we are only running this for a single Object Type, fish that out
	var objTypeID
	if (req.event == "runSingle") {
		objTypeID = req.params[0]
	}

	//	Fish out the synchMode from the request. 
	//	synchMode options:	
	//		0 = Updated based on Synch Schedule, only update object Types that are due for synching
	//		1 = Ignore Synch Schedule, update ALL object types (ex: NotificaitonTypes, Orders, etc..)
	//		2 = Igore the Last Synch datetime of each object type (ex: update all Notifications in the system)
	//		3 = 1 + 2, full system refresh, all entries are updated, reguardless of schedule of LastSynch date/time
	//		4 = 3, but the Database is cleared first
	var synchMode
	if (req.data.synchMode) {
		synchMode = req.data.synchMode
	} else {
		synchMode = 0
	}

	//	See if we are just synching one specific object
	var objID
	if (req.data.objectID) {
		objID = req.data.objectID
	}

	//	**************************************************************************************************************
	//	STEP 1 - Based on Synch Schedule and back-end ERP changes add objects that need to synch to the log
	//	**************************************************************************************************************
	if (synchMode === 1 || synchMode === 3 || synchMode === 4) {
		var ignoreSchedule = true
	}
	await aggregateLog(req, objTypeID, ignoreSchedule, objID)


	//	**************************************************************************************************************
	//	STEP 2 - Process Changes fror Synch Log
	//	**************************************************************************************************************
	if (synchMode === 2 || synchMode === 3 || synchMode === 4) {
		var ignoreLastSynch = true
	}

	var deleteExistingEntries
	if (synchMode === 4) {
		deleteExistingEntries = true
	}

	const result = await processLog(req, ignoreLastSynch, objTypeID, objID, deleteExistingEntries)

	//	Mark Job as Stopped
	await stopJob(req, result)

	//	Log to Console until we can figure out how to send this out in the reply
	console.log("Processed: " + result.processed)
	console.log("Success: " + result.successes)
	console.log("Errors: " + result.errors)

	return req.reply(result) //TODO - Figure out if/how we can send the result in the response payload
}

//	DATA SYNCH OUT
const dataSynch = async (req, simulate, entity, objID, data) => {

	// const dataIn = Object.assign( {}, data)
	const dataIn = deepClone(data)

	await bootstrapDBServices(req)

	const segments = entity.name.split(".")
	const service = segments[0]
	const entityName = segments[1]

	const dataOut = await synchFunctionOut(req, simulate, service, entityName, objID, dataIn)
	return dataOut

}

// CLEAR LOG
const clearLog = async (req) => {

	await bootstrapDBServices(req)

	var clearMode
	if (req.data.clearMode) {
		clearMode = req.data.clearMode
	} else {
		clearMode = 0
	}

	clearLogDB(req, clearMode)

}

// EXPORT - These are the "Public" functions we can export
module.exports = {
	dataSynchMaster,
	dataSynch,
	clearLog
};

//----------------------------------------------------------------------------------------------------------------
//	"PRIVATE" FUNCTIONS - functions that can only be called from within the file
//----------------------------------------------------------------------------------------------------------------

//	BOOTSTRAP DB SERVICES
const bootstrapDBServices = async (req) => {
	//	This function adds the db and srv objects to the req object
	//	in order to decrease repition of code where DB updates are made throughout this file

	req.synch = {}
	req.synch.dbTx = cds.transaction(req)
	req.tenantID = await getTenantID()

	//	Main Service = DataSynch
	req.synch.srv = await cds.connect.to(mainService)
	req.synch.srvTx = req.synch.srv.transaction(req)

}

//	START JOB
const startJob = async (req) => {

	const {
		DataSynchJob
	} = req.synch.srv.entities

	//	Get Log Entries with Pending Status	
	const jobs = await req.synch.srvTx.run(SELECT.from(DataSynchJob).where({
		tenantID: req.tenantID
	}))

	if (jobs && jobs.filter(job => job.Status == 1).length > 0) {
		throw new redfigError(400, "Mast Synch Job is Already running")
	}

	const currentDateTime = new Date()
	//	Update Job Status
	// return srvTx.run(		//TODO Error: Error: No handler registered for UPDATE redfig.plantmaint.DataSynchJob
	return req.synch.dbTx.run(UPDATE(DataSynchJob).set({
		Status: 1 //Set Job to Status "Running"
		//	LastRun	: currentDateTime	//TODO - Fix
	}).where({
		tenantID: req.tenantID
	}))
}

//	STOP JOB
const stopJob = async (req, result) => {

	const {
		DataSynchJob
	} = req.synch.srv.entities

	// return srvTx.run(		//TODO Error: Error: No handler registered for UPDATE redfig.plantmaint.DataSynchJob
	return req.synch.dbTx.run(UPDATE(DataSynchJob).set({
		Status: 0, //Set Job to Status "Stopped"
		Processed: result.processed,
		Successes: result.successes,
		Errors: result.errors
	}).where({
		tenantID: req.tenantID
	}))
}

//	AGGREGATE LOG
const aggregateLog = async (req, objTypeID, ignoreSchedule, objID) => {
	//	This function looks at the Synch Schedule and 

	//	Check Object Types that should be processed and add them to the log with status P
	await addPendingEntriesToLog(req, objTypeID, ignoreSchedule, objID)

	//	Add entries that need to be reprocessed because of error
	await addErrorEntriesToLog(req, objTypeID)
}

//	ADD PENDING ENTRIES TO LOG
const addPendingEntriesToLog = async (req, objTypeID, ignoreSchedule, objectID) => {

	//  This function adds entries ot the log with status 'P'
	//	unless ignoreSchedule is set, it checks the Synch schedule for each Object Type
	//	if a specific objTypeID (object Type ID) is passed in, only that Object Type (Ex: Notification)
	//		is added to the log

	//Get all of the Synch Objects
	var synchObjects = await getSynchObjects(req)

	//	In general, only inbound calls should be added to the log as Pending, 
	//	Outbound calls are added during runtime (ex: when a Notficaition is created)
	//	The only exception if we are synching a specific object ID
	if (!objectID) {
		synchObjects = synchObjects.filter((synch) => synch.Direction === "IN")
	}


	//Determine which ones should run
	if (objTypeID) {
		// If an object Type ID is passed in (ex: NotificationTypes)
		//	Add this object type to the log, reguardless of schedule
		//	but first check if it's in the lust of synch objects
		const found = synchObjects.find((synch) => {
			return synch.ID === objTypeID
		})
		if (found) {
			addToLog(req, objTypeID, objectID)
		}
	} else if (ignoreSchedule) {
		//	IF we are ignoring the schedule, all all synch objects to log
		await Promise.all(synchObjects.map((obj) => addToLog(req, obj.ID, objectID)))
	} else {
		// Otherwise, check the Synch Schedule before adding the object to the log
		await Promise.all(synchObjects.filter((obj) => {
			//Determine if we should synch this object
			return checkSynchSchedule(obj)
		}).map((obj) => {
			return addToLog(req, obj.ID, objectID)
		}))
	}
}

// CLEAR LOG DB
const clearLogDB = async (req, clearMode) => {

	//	clearMode drives what gets cleared
	//	0 = Success/Resolved Entries Only
	//	1 = Success/Resolved and Error
	//	5 = All entries

	const {
		DataSynchLog
	} = req.synch.srv.entities
	var statuses = []

	switch (clearMode) {
		case 0:
			statuses.push("S")
			statuses.push("R")
			return req.synch.dbTx.run(DELETE(DataSynchLog).where({
				SynchStatus: {
					in: statuses
				}
			}))

		case 1:
			statuses.push("S")
			statuses.push("E")
			statuses.push("R")
			return req.synch.dbTx.run(DELETE(DataSynchLog).where({
				SynchStatus: {
					in: statuses
				}
			}))

		case 5:
			return req.synch.dbTx.run(DELETE(DataSynchLog))
	}

}

//	ADD ERROR ENTRIES TO LOG
const addErrorEntriesToLog = async (req, objTypeID, objID) => {

	//	Get all Error Entries
	var errorLogEntries = await getLogEntriesByStatus(req, "E", objTypeID)
	if (!errorLogEntries || errorLogEntries.length == 0) {
		return
	}

	if (objID) {
		errorLogEntries = errorLogEntries.filter(entry => entry.ObjectID === objID)
	}

	//	Get all current Pending Log Entries
	//	IF there is alreadyd a pending log entry for this error, we don't need to create another one
	//	We don't want to process the same Object Type twice
	const pendingLogEntries = await getLogEntriesByStatus(req, "P")

	//	The addErrorEntryToLog function processes several async functions
	//	these should be in series, but are performed in paralell 
	await Promise.all(errorLogEntries.map((errorLogEntry) => {
		return addErrorEntryToLog(req, errorLogEntry, pendingLogEntries)
	}))
}

//	ADD ERROR ENTRY TO LOG
const addErrorEntryToLog = async (req, errorLogEntry, pendingLogEntries) => {

	//Check if there is already a corresponding Pending Entry
	const pendingLogEntry = pendingLogEntries.find((pendingLogEntry) => {
		return pendingLogEntry.ObjectTypeID == errorLogEntry.ObjectTypeID
	})

	if (pendingLogEntry) {
		errorLogEntry.resolveBy_ID = pendingLogEntry.ID
	} else {
		const insertResults = await addToLog(req, errorLogEntry.ObjectTypeID, errorLogEntry.ObjectID)
		// errorLogEntry.resolvedBy_ID = [insertResults]pendingLogEntry.ID
		errorLogEntry.resolvedBy_ID = null
	}

	//Update the Error'd Log Entry to indicate it's being resolved by another Log Entry 
	const {
		DataSynchLog
	} = req.synch.srv.entities
	return await req.synch.dbTx.run(UPDATE(DataSynchLog).set({
			resolvedBy_ID: errorLogEntry.resolvedBy_ID,
			synchStatus: "R"
		}) //Resolved by another subsequent Log Entry
		.where({
			ID: errorLogEntry.ID
		}))
}

//	CHECK SYNCH SCHEDULE
const checkSynchSchedule = (obj) => {
	const currentDateTime = new Date()
	if (obj.Frequency && obj.Direction === "IN") {
		if (obj.LastSynch) {
			//How Many minutes has int been since the last synch?
			const lastSynchDateTime = new Date(obj.LastSynch)
			const elapsed = (currentDateTime - lastSynchDateTime) / 60000
			// Is the greater than the configured synch frequency for this object?
			if (elapsed > obj.Frequency) {
				return true
			}
		} else {
			return true
		}
	}
	return false
}

//	ADD TO LOG
const addToLog = async (req, objTypeID, objectID) => {

	const {
		DataSynchLog
	} = req.synch.srv.entities

	//const insertResults = await req.synch.srvTx.run( INSERT.into(DataSynchLog)		//TODO - Figure out why this causes a Error: No handler registered for CREATE redfig.plantmaint.DataSynchLog
	const insertResults = await req.synch.dbTx.run(INSERT.into(DataSynchLog)
		.entries({
			objectType_ID: objTypeID,
			tenantID: req.tenantID,
			ObjectID: objectID,
			SynchStatus: "P"
		}))
	// return insertResults[0]
	return insertResults
}

//	PROCESS LOG
const processLog = async (req, ignoreLastSynch, objTypeID, objID, deleteExistingEntries) => {

	//Get All Log Entries that are pending
	var pendingEntries = await getLogEntriesByStatus(req, "P")

	if (!pendingEntries) {
		return {
			"processed": 0
		}
	}

	if (objTypeID) {
		pendingEntries = pendingEntries.filter(entry => entry.objectType_ID === objTypeID)
	}
	if (objID) {
		pendingEntries = pendingEntries.filter(entry => entry.ObjectID === objID)
	}

	//TODO - Sort pendingEntries by SynchOrder


	//	Separate Outbound synchs from Inbound
	const pendingEntriesOut = pendingEntries.filter((entry) => entry.Direction === "OUT")
	const pendingEntriesIn = pendingEntries.filter((entry) => entry.Direction === "IN")

	//	Process Outbound first
	var resultsOut = []
	resultsOut = await Promise.all(
		pendingEntriesOut.map((log) => {
			return processLogEntry(req, log, ignoreLastSynch)
		})
	)

	//	Delete Data??
	if (deleteExistingEntries) {

		const entities = pendingEntriesIn.map(entry => entry.EntityName)
		const distinctEntities = [...new Set(entities)]

		await Promise.all(distinctEntities.map(entityName => {
			const entity = req.synch.srv.entities[entityName]
			if (objID) {
				return req.synch.dbTx.run(DELETE(entity).where({
					ID: objID
				}))
			} else {
				return req.synch.dbTx.run(DELETE(entity))
			}
		}))
	}

	//	Process Inbound Second
	var resultsIn = []
	resultsIn = await Promise.all(
		pendingEntriesIn.map((log) => {
			return processLogEntry(req, log, ignoreLastSynch)
		})
	)

	//	Combine Results
	var results = []
	results = resultsOut.concat(resultsIn)

	//Collect results just for the HTTP response, no further DB updates are made
	return collectResults(results)
}

//	COLLECT RESULTS 
const collectResults = (results) => {
	//	This function digests the results array and returns a single object type with the summary

	const result = {}
	result.processed = results.length
	result.errors = results.filter((result) => {
		if (result.status == "E") {
			result.error.logErrors() //Log Errors to the console until we figure out how to pass them back in the reply
			return true
		}
	}).length
	result.successes = results.filter((result) => {
		if (result.status == "S") {
			return true
		}
	}).length

	return result
}

//	PROCESS LOG ENTRY
const processLogEntry = async (req, log, ignoreLastSynch) => {


	//  For configuration data, we always grab all records and ignore the Last Synch date
	//	The may seem the same, but the two indicators below are different
	//		ignoreLastSynch means we try to synch all ERP entries, reguardless of when they were last updated in ERP
	//		synchAll		means we try to synch all HANA entries, entries in HANA that don't come back from ERP are marked for deletion
	//	if the synchAll indicator is set, then the ignoreLastSynch indicator must also be set, otherwise this code will delete HANA entries
	//		that fall outsied of the LastSynch date
	//	It is possible to have the ignoreLastSynch indicator set, but not the synchAll
	//		that means the code will grab all entries from ERP (reguardless of when it was last synched), but will not delete HANA entries
	//		that don't have a corresponding ERP entry

	var synchAll = log.DataType === "C" // Synch All entries if data type is config
	ignoreLastSynch = ignoreLastSynch || synchAll // If synching all enrties, must ignore last synch also. Otherwise ignore last synch is caller function says so


	var logs = [] // Array of log entries that get updated
	var redfigError = {}

	try {
		if (log.Direction === "IN") {
			logs = await synchFunctionIn(req, log, ignoreLastSynch, synchAll)
		} else {
			const response = await synchFunctionOut(req, false, log.ServiceName, log.EntityName, log.ObjectID) //Don't simulate
			log.Message = response.ERPID
		}
		log.SynchStatus = "S"
	} catch (err) {
		redfigError = errorHandleAdd(err, 500, "Error during " + log.Direction + " Synch Function for " + log.EntityName)
		log.SynchStatus = "E" // Log status should be set to E = Error
		log.Message = redfigError.stringfy()
	}

	try {
		await updateLogEntries(req, log, logs) //	Update Log Entry with Success or Error, and split Logs entry if present
		await updateSynchObjectType(req, log, logs) //	Update Object Type Entry 
	} catch (err) {
		redfigError = errorHandleAdd(err, 500, "Error updating log entries post-processing " + log.EntityName)
		log.SynchStatus = "E" // Log status should be set to E = Error
	}

	if (redfigError.getCode) {
		log.Message = redfigError.stringfy()
		return {
			"status": "E",
			"error": redfigError
		}
	} else {
		return {
			"status": "S"
		}
	}
}

//	UPDATE SYNCH OBJECT TYPE
const updateSynchObjectType = async (req, log, logs) => {

	//Update Log Object Type
	const {
		DataSynchObjects
	} = req.synch.srv.entities
	const entity = req.synch.srv.entities[log.EntityName]

	//	If the Synch status is 'E', we don't set the LastSynch
	if (log.SynchStatus != "E") {

		// const count = dbTx.run(SELECT.count(true).from(entity))		//TODO - Add Count of Entries to DataSynchObjects table

		var dateTime = new Date()
		await req.synch.dbTx.run(UPDATE(DataSynchObjects).set({
				LastSynch: dateTime.toJSON(),
				LastSynchStatus: log.SynchStatus
			})
			.where({
				ID: log.objectType_ID
			}))
	} else {
		await req.synch.dbTx.run(UPDATE(DataSynchObjects).set({
				LastSynchStatus: log.SynchStatus
			})
			.where({
				ID: log.objectType_ID
			}))
	}

}

//	GET SYNCH OBJECTS
const getSynchObjects = async (req, ID) => {

	const {
		DataSynchObjects
	} = req.synch.srv.entities

	//	Get Sync Object Master Table
	var synchObjects = []
	if (ID === undefined) {
		synchObjects = await req.synch.srvTx.run(SELECT.from(DataSynchObjects)) //TODO Triggering Infinite Loop
		//synchObjects = await dbTx.run(SELECT.from(DataSynchObjects) )	

	} else {
		synchObjects = await req.synch.srvTx.run(SELECT.from(DataSynchObjects).where({
			ID: ID
		}))
	}

	return synchObjects
}

//	GET PENDING LOG ENTRIES
const getLogEntriesByStatus = async (req, status, objTypeID) => {
	//	Retrun Log Entries with Inputted status

	const {
		DataSynchLog
	} = req.synch.srv.entities

	//	Get Log Entries with Pending Status	and (optionally) a Object Type ID
	if (objTypeID) {
		return await req.synch.srvTx.run(SELECT.from(DataSynchLog).where({
			SynchStatus: status,
			objectType_ID: objTypeID
		}))
	} else {
		return await req.synch.srvTx.run(SELECT.from(DataSynchLog).where({
			SynchStatus: status
		}))
	}
}

// UPDATE LOG ENTRY
const updateLogEntries = async (req, log, logs) => {
	/*	Import:		req - Request Objects
	 *				log		- Original Log Entry, the one being processed
	 *				logs	- Resulting log entries (log split, see below)
	 *	Returns:	Nothing, error will be thrown as exceptions	
	 *	Throws:		Redfig or Generic Error
	 */

	//Update Log Database
	const {
		DataSynchLog
	} = req.synch.srv.entities

	//	LOG SPLIT - If the importing parameter "logs" has multiple entries,
	//	That means this original log entry resulted in multiple log updates
	//	We add these here:
	if (logs && logs.length > 0) {

		const entries = logs.map(logItem => ({
			tenantID: req.tenantID,
			objectType_ID: logItem.objectType_ID,
			ObjectID: logItem.ObjectID,
			SynchStatus: logItem.SynchStatus,
			Message: logItem.Message
		})).map(entry => {
			entry.Message = truncate(entry.Message)
			return entry
		})

		const results = await req.synch.dbTx.run(INSERT.into(DataSynchLog).entries(...entries)) //Split out array entries into comma list [1,2,3] => 1,2,3

		//Check if any of the inserts errerd out
		if (log.SynchStatus == "S" && results != entries.length) {
			log.SynchStatus = "W" //Throw Warning as we don't need to re-process this again
			log.Message = "ERROR in Post Processing while updating Log Entries"
		}
	}

	//	Update original log entry
	log.Message = truncate(log.Message)
	await req.synch.dbTx.run(UPDATE(DataSynchLog).set({
			SynchStatus: log.SynchStatus,
			Message: log.Message
		})
		.where({
			ID: log.ID
		}))

}

//	TRUNCATE
const truncate = (string, len) => {

	if (!len) {
		len = 200
	}

	if (string.length > len) {
		return string.substring(0, len - 4) + "..."
	} else {
		return string
	}

}

//----------------------------------------------------------------------------------------------------------------
//	SYNCH FUNCTIONS - functions used to Synch Specific Entities
//----------------------------------------------------------------------------------------------------------------

//	SYNCH FUNCTION - STANDARD OUT
const synchFunctionOut = async (req, simulate, serviceName, entityName, objID, dataNew) => {
	/*	
	 *		Import:	
	 *			req 		- Standard Request Object for making data based Updates
	 *			simulate	- Simulate flag is passed down to ERP, when true, no updates are made
	 *			serviceName	- Service used for reading data (ex: WorkOverService)
	 *			entityName	- Entity being updated (ex: Notifications, Orders)
	 *			objID		- ID for the corresponding object being updated
	 *			dataNew		- data being updated, can be a deep structure. If empty, we simply udpate what's already 
								in the Database
	 *		Return:	
	 *			response	- Result from back-end ERP system
	 *
	 *		Description:	Makes a POST call to the backend ERP system. If the simulation flag is passed, the actual
	 *						updates are made. 
	 */


	//	Get Existing Data
	const srv = await cds.connect.to(serviceName)
	const srvTx = srv.transaction(req)
	const entityData = srv.entities[entityName]
	const [dataCurrent] = await srvTx.run(SELECT.from(entityData).where({
		ID: objID
	}))

	if (!dataCurrent) {
		throw new redfigError(500, "Could not locate " + entityName + ", object: " + objID)
	}

	var data = {} //Acttual data structure being sent to back-end ERP

	const entity = req.synch.srv.entities[entityName]

	if (dataNew) {
		//	When the UI makes updates, only the fields that are changed are passed back
		//	to node. However, we need to pass ALL fields to the back-end ERP. Therefore, we need to
		//	retrieve from the DB the fields that the UI is not passing in
		//		dataNEw 	- will only contain the objects being changed
		//		dataCurrent - will contain full existing data
		//		data		- Merging dataNew into dataCurrent
		data = await moveCorresponding(req, entity, dataNew, dataCurrent, "OUT")
	} else {
		//	Even if pushing all data, call this anyways to map ERP fields
		data = await moveCorresponding(req, entity, dataCurrent, dataCurrent, "OUT")
	}

	//	Set ERPFunction indicator at the header level if it is not set already
	//	This would only happen if we are manually forcing and outbound sync
	if (!data.ERPFunction) {
		if (data.ERPID) {
			data.ERPFunction = "U"
		} else {
			data.ERPFunction = "I"
		}
	}

	//	Post to ERP - CODE_HERE
	var response = {}
	try {
		response = await postDataToERP(entityName, data, simulate)
	} catch (err) {
		redfigError = errorHandleAddThrow(err, 500, "Error posting to Back-End ERP")
	}

	//	This will be taken care of in UpsertHANA
	//	
	// //	Update ERP ID on object
	// 	if(response.ERPID && !dataCurrent.ERPID){
	// 		req.synch.dbTx.run( UPDATE(entity).set({	ERPID: response.ERPID}).where({ID: objID}))
	// 	}

	//	Remove fields from data that are not in the entity TODO: This may be already be taken care of in moveCorresponding
	data = cleanUpObject(req, data, entity)

	//	Map ERP Response into the HANA fields	
	var dataOut = await moveCorresponding(req, entity, response, data, "IN")

	//	Upsert into HANA
	if (simulate === false) {
		const dataSet = []
		dataSet.push(dataOut)

		await upsertHANA(req, dataSet, entity)
	}

	return dataOut
}


//	SYNCH FUNCTION - STANDARD IN
const synchFunctionIn = async (req, log, ignoreLastSynch, synchAll) => {
	/*	
	 *		Import:	
	 *			req - Standard Request Object for making data based Updates
	 *			log - Single log entry for the data object that needs to be synched
	 *		Return:	
	 *			logs - Array of log entries that got updated, split out based on how many entries actually got synched
	 *
	 *		Description:	This function synchs data between ERP and HANA by comparing the two data sets
	 *						The Entity that is synched is passed in the 'log' import parameter. It's possible that several
	 *						entries are inserted/updated for a given entity, the 'logs' return parameter will contain all 
	 *						entries that are updated here.
	 */

	//	**************************************************************************************************************
	//	STEP 1 - Call Back-end ERP system to get relevant data set
	//	**************************************************************************************************************

	//For Master/transaction Data, we only grab records that were modified since the last time we synched
	if (!ignoreLastSynch) {
		var lastSynch = log.LastSynch
	}

	var dataSetERP = []
	try {
		dataSetERP = await getSetERP(req, log.EntityName, lastSynch, log.ObjectID)
	} catch (err) {
		errorHandleAddThrow(err, 500, "Error getting data from Back-End ERP")
	}

	if (dataSetERP.length === 0) {

		//	If we are ignoring the last synch data AND looking for a specific object
		//	we should have received data back from SAP. If we haven't raise an error
		if (ignoreLastSynch && log.ObjectID) {
			throw new redfigError(500, "Could not find Document/Object in Back-End ERP")
		}

		log.Message = "No Updates Found"
		return
	}

	//	**************************************************************************************************************
	//	STEP 2 - Get Entries from HANA
	//	**************************************************************************************************************

	//	the synchAll indicator means that we synch all entries into HANA, even if they are not returned from ERP
	//	which means entries that are not in ERP are marked for deletion. If we are synching all entries, we don't need 
	//	to get ERPID's because the function getSetHANA will simply get all entries in HANA
	if (!synchAll) {
		var ERPIDs = dataSetERP.map(dataERP => dataERP.ERPID)
	}

	var dataSetHANA = []
	try {
		dataSetHANA = await getSetHANA(req, log.ServiceName, log.EntityName, ERPIDs)
	} catch (err) {
		errorHandleAddThrow(err, 500, "Error getting data from HANA")
	}

	//	**************************************************************************************************************
	//	STEP 3 - Deep Update using DataSynch Object as a header entry
	//	**************************************************************************************************************

	//	The Deep Update takes care of all merging scenarios (Create, Update, Delete) of child entries
	try {
		await mergeIntoHANA(req, log, dataSetERP, dataSetHANA, synchAll)
	} catch (err) {
		errorHandleAddThrow(err, 500, "Error Merging Data into HANA")
	}

	//	**************************************************************************************************************
	//	STEP 4 - Split Log Entries so the caller functino know which Objects got updated for this entry
	//	**************************************************************************************************************

	if (dataSetERP.length > 1) {
		log.Message = "Multiple Entries Updated, see individual logs"
		return splitLogEntries(log, dataSetERP) //Return Split up Log Entries
	} else {
		if (!log.Message) {
			log.Message = "Entry Updated Successfully"
		}
		return []
	}
}


//	REMOVE ERP FUNCTION
const removeERPFunction = async (req, entity, data) => {

	for (const property in data) {

		const element = entity.elements[property]
		if (element.name === "ERPFunction") {
			await req.synch.dbTx.run(UPDATE(entity).set({
				ERPFunction: ""
			}).where({
				ID: data.ID
			}))
			data.ERPFunction = ""

		} else if (element.type === "cds.Composition") {

			const childEntityName = getEntityNameFromTarget(element.target)
			const childEntity = req.synch.srv.entities[childEntityName]

			const promiseResult = await Promise.all(data[property].map((line) => {
				if (line.ID) {
					removeERPFunction(req, childEntity, line) //RECURSION
					return line
				}
			}))
		}
	}

}

//	CLEAN UP OBJECT
const cleanUpObject = (req, data, entityIn) => {

	//	This function checks the incoming data against the entity and
	//	deletes any field in 'data' that is does not have a corresponding element in 'entity'
	//	or the property is a virtual one. recursive function also works for arrays
	var entity = {}
	if (typeof entityIn !== "object") {
		entity = req.synch.srv.entities[entityIn]
	} else {
		// entity = Object.assign({}, entityIn)
		entity = dataOut = deepClone(entityIn)
	}

	for (const property in data) {
		if (!entity.elements[property] || entity.elements[property].virtual === true) {
			delete data[property]
		} else if (entity.elements[property].type === "cds.Composition") {
			const entityName = getEntityNameFromTarget(entity.elements[property].target)
			data[property] = data[property].map(line => cleanUpObject(req, line, entityName))
		}
	}

	return data
}

//	MERGE INTO HANA
const mergeIntoHANA = async (req, log, dataSetERP, dataSetHANA, synchAll) => {

	//	Get Entity Object for this Object Type
	const entity = req.synch.srv.entities[log.EntityName]

	// Get correspodning HANA entry if it already exists
	const dataSet = await Promise.all(dataSetERP.map((dataERP) => {
		const dataHANA = dataSetHANA.find((line) => line.ERPID == dataERP.ERPID)

		//	MOVE CORRESPONDING
		return moveCorresponding(req, entity, dataERP, dataHANA, log.Direction)

	})).catch((err) => {
		console.log("rejected Promise in mergeIntoHANA")
		redfigError = errorHandleAddThrow(err, 500, "Promise Error while moving HANA entries")
	})

	await upsertHANA(req, dataSet, entity, synchAll, dataSetHANA)

}

//	UPSERT HANA
const upsertHANA = async (req, dataSet, entity, synchAll, dataSetHANA) => {
	/*	
	 *		Import:	
	 *			req 		- Standard Request Object for making data based Updates
	 *			dataSet 	- Array of data being UPSerted into HANA
	 *			synchAll	- OPTIONAL, indicator we need to synch all records, must pass in dataSetHANA as well if set to true
	 *			dataSetHANA - OPTIONAL, if synchAll is true, use this data to delete records not present in dataSet
	 *		Return:	
	 *			
	 *
	 *		Description:	Thsi function takes a set of data (dataSet) and updates HANA accordingly
	 *						The assumption is that the data in "dataSet" is already formatted with the correct fields
	 */

	//	Need to separate entries that will be updated vs. new entries that will be inserted
	var dataSetIns = []
	var dataSetUpd = []
	var dataSetDel = []

	dataSet.forEach((data) => {

		delete data.objActions //	Can't Update objActions TODO: Make this dynamic for any composition that is not relfected in the DB
		delete data.LastSynch //	This parameter should not be set into ERP

		if (data.ID) {
			dataSetUpd.push(data)
		} else {
			dataSetIns.push(data)
		}
	})

	//	IF we are synching all entries, then we need to take all entries in HANA, that are not
	//	being passed in by the ERP, and mark them deleted
	if (synchAll) {
		dataSetDel = dataSetHANA.filter((dataHANA) => {
			const dataUpd = dataSetUpd.find((dataUpdLine) => {
				return dataUpdLine.ID == dataHANA.ID
			})
			return !dataUpd //If a dataSetUpd is found, return false, so it's removed from dataSetDel
			//	dataSetDel now only contains entries that are not being updated, and therefore need to be marked for deletion
		})
	}


	//	Insert new recrods
	if (dataSetIns.length > 0) {
		try {
			const result = await req.synch.dbTx.run(INSERT.into(entity).entries(...dataSetIns))
		} catch (err) {
			redfigError = errorHandleAddThrow(err, 500, "Error inserting entrirs")
		}
	}

	//	Update Existing Records		//TODO - Figure out how to do this in one update
	if (dataSetUpd.length > 0) {
		try {
			const results = await Promise.all(dataSetUpd.map((dataUpd, index) => {
				// return srvTx.run(UPDATE(entity).data(dataUpd).where({ID: dataUpd.ID}))	//TODO -  No handler registered for UPDATE redfig.plantmaint.NotificationType
				try {
					return req.synch.dbTx.run(UPDATE(entity).data(dataUpd).where({
						ID: dataUpd.ID
					}))
				} catch (err) {
					redfigError = errorHandleAddThrow(err, 500, "Error Updating [" + index + "] " + dataUpd.ERPID + " / " + dataUpd.ID)
				}
			}))
		} catch (err) {
			redfigError = errorHandleAddThrow(err, 500, "Error updating entries ")
		}
	}

	//	Mark "Deleted" records with a deletion indicator
	if (dataSetDel.length > 0) {
		const delIDs = dataSetDel.map(dataDel => dataDel.ID)
		await req.synch.dbTx.run(UPDATE(entity).set({
			deletionInd: true
		}).where({
			ID: {
				in: delIDs
			}
		}))
	}
}

//	MOVE CORRESPONDING
const moveCorresponding = async (req, entityTo, dataFrom, dataTo, direction) => {
	/*	
	 *		Import:	
	 *			req 		- Standard Request Object for making database Updates
	 *			entityTo	- OData entity object for the TO data structure, including list of fields (entityTo.elements)
	 *			dataFrom	- Source data
	 *			dataTo		- Destination data, could be prefilled or empty
	 *		Return:	
	 *			dataOut		- Structure data is being merged into, starts with dataTo, adding fields from dataFrom
	 *
	 *		Description:	Standard MOVE CORRESPONDING call. Only the elements that exist in "dataTo", and have a 
	 *						corresponding value in "dataFrom" are moved from "dataFrom" => "dataTo"
	 */


	//	This function move corresponding properties 
	//		so that properties that don't exist in HANA are excluded

	if (!entityTo) {
		throw new redfigError(500, "entity input is required for moveCorresponding")
	}

	// var dataOut =  Object.assign( {}, dataTo)
	var dataOut = deepClone(dataTo)

	if (!dataOut) { // Don't Try removing this, you will lose the ID relationships in the child arrays
		dataOut = {}
	}

	dataOut.deletionInd = false // Initialize Deletion Indicator
	dataOut.tenantID = req.tenantID

	//	Move values from dataERP to dataHANA
	try {
		const propNames = []
		for (const property in entityTo.elements) {
			var element = entityTo.elements[property]

			//	MOVE CORRESPONDING
			dataOut = await moveCorrespondingMap(req, element, dataFrom, dataOut, direction)

			if (!element.virtual) {
				propNames.push(property)
			}
		}

		//	Remove any entries that are not part of entityTo
		//	For Outbound, this is taken care of in the ERPFunctions
		if (direction === "IN") {
			for (const property in dataOut) {
				const found = propNames.find(prop => prop === property)
				if (!found) {
					delete dataOut[property]
				}
			}
		}

	} catch (err) {
		redfigError = errorHandleAddThrow(err, 500, "Error Mapping Corresponding entries in " + entityTo.name)
	}

	//	These fields should never be set by us
	delete dataOut.createdAt
	delete dataOut.createdBy
	delete dataOut.modifiedAt
	delete dataOut.modifiedBy

	return dataOut
}

//	MOVE CORRESPONDING MAP
const moveCorrespondingMap = async (req, element, dataFrom, dataTo, direction) => {
	//
	//	This function moves a property (element.name) from the dataFrom object to dataTo
	//	if this property is present in dataFrom, if the value is null, the null value is moved
	//	2 special scenarios
	//		1 - Associations:	We perform a lookup based on ERPID and ID
	//				For Inbound Scenario (direction = "IN") - Look up the HANA ID from the ERPID
	//				For Outbound Scenario (direction = "OUT") - Look up the ERPID from the HANA ID
	//		2 - Compositions:	This calls a recursive funciton that maps all child lines in the composition
	//							from dataFrom to dataTo

	//	Debug Helpmer
	if (element.name.includes(dbHelperField)) {
		console.log("Debug " + dbHelperField)
	}


	// var dataOut = Object.assign( {}, dataTo)
	var dataOut = deepClone(dataTo)


	if (element.type === "cds.Association" && element.keys) { //ex: notificationType

		var propertyAssociated = element.keys[0].$generatedFieldName //ex: notificationType_ID
		var propertyERP = convertFirstToUpper(element.name) //ex: NotificationType

		const segments = element.target.split(".") //ex: SynchService.NotificationTypes -> [SynchService, NotificationTypes]
		const entityName = segments[segments.length - 1] //ex: NotificationTypes

		try {
			if (direction === "IN") { // Find HANA ID for Corresponding ERP ID
				if (dataFrom.hasOwnProperty(propertyERP)) { // dataFrom[property] could equal a false boolean
					//ex: dataOut.notificationType_ID = ID from NotificationTypes where ERP = dataFrom.NotificationType
					dataOut[propertyAssociated] = await getIDByERPID(req, entityName, dataFrom[propertyERP])
				}
			} else if (direction === "OUT") { // Find ERP ID for Corresponding HANA ID
				if (dataFrom.hasOwnProperty(propertyAssociated)) {
					// if(dataFrom[propertyAssociated] !== undefined){
					dataOut[propertyERP] = await getERPIDByID(req, entityName, dataFrom[propertyAssociated])
				} else if (dataOut.hasOwnProperty(propertyAssociated)) {
					// } else if(dataOut[propertyAssociated] != undefined){
					dataOut[propertyERP] = await getERPIDByID(req, entityName, dataOut[propertyAssociated])
				}

			}
		} catch (err) {
			redfigError = errorHandleAddThrow(err, 500, "Error Matching ERPIDs for element" + element.name)
		}

	} else if (element.type === "cds.Composition" && dataFrom.hasOwnProperty(element.name)) {

		//	If this array doesn't already exist in the HANA Structure, add a blank one here
		if (!dataOut[element.name]) {
			dataOut[element.name] = []
		}

		if (dataFrom[element.name]) {
			try {
				dataOut[element.name] = await Promise.all(dataFrom[element.name].map((lineFrom) => {
					const entityName = getEntityNameFromTarget(element.target)
					var entity = req.synch.srv.entities[entityName]

					if (!entity) {
						throw new redfigError(500, "Could not find object for entity " + entityName)
					}

					var lineTo = {}

					if (direction === "IN") { // Find To Line for Corresponding ERP ID
						lineTo = dataOut[element.name].find((lineHANAin) => {
							return lineFrom.ERPID && lineHANAin.ERPID === lineFrom.ERPID
						})

						//	If not found using the ERPID, search by ID, which is passed in Outbound calls
						if (!lineTo) {
							lineTo = dataOut[element.name].find((lineHANAin) => {
								return lineFrom.ID && lineHANAin.ID === lineFrom.ID
							})
						}

					} else if (direction === "OUT") { // Find ERP ID for Corresponding HANA ID
						lineTo = dataOut[element.name].find((line) => {
							// return lineFrom.ID && line.ID === lineFrom.ID
						})
					}

					const lineOut = moveCorresponding(req, entity, lineFrom, lineTo, direction) //Recursion
					return lineOut

				}))
			} catch (err) {
				redfigError = errorHandleAddThrow(err, 500, "Error mapping element " + element.name)
			}
		} else {
			dataOut[element.name] = []
		}

	} else {
		//	Simple transfer the value, even if it's null
		if (direction === "IN" && element.name === "ID") {
			//	Blank IF statement for readibility
			//	ERP does have a "ID" field, but it's never filled in on the Inbound side
		} else if (dataFrom.hasOwnProperty(element.name)) {
			dataOut[element.name] = dataFrom[element.name]
		}

		//	Don't want a blank ID field, needs to eb generated
		if (element.name === "ID" && !dataOut.ID) {
			delete dataOut.ID
		}
	}

	return dataOut
}

//	CONVERT FIRST TO UPPER
const convertFirstToUpper = (string) => {
	return string[0].toUpperCase() + string.substring(1)
}

//	GET ID BY ERPID
const getIDByERPID = async (req, entityName, ERPID) => {
	if (!ERPID) {
		return null
	}
	const entity = req.synch.srv.entities[entityName]

	const [lookup] = await req.synch.srvTx.run(SELECT.from(entity).where({
		ERPID: ERPID
	}))
	if (lookup) {
		return lookup.ID
	} else {
		return null
	}
}

//	GET ERPID BY ID
const getERPIDByID = async (req, entityName, ID) => {
	if (!ID) {
		return null
	}
	const entity = req.synch.srv.entities[entityName]

	const [lookup] = await req.synch.srvTx.run(SELECT.from(entity).where({
		ID: ID
	}))
	if (lookup) {
		return lookup.ERPID
	} else {
		return null
	}

}

//	GET SET HANA
const getSetHANA = async (req, serviceName, entityName, ERPIDs) => {

	//	User the original service name in order to get the expanded entries
	const srv = await cds.connect.to(serviceName)
	const srvTx = srv.transaction(req)
	const entity = srv.entities[entityName]

	//Get Corresponding Record in HANA
	var dataSetHana = []
	if (Array.isArray(ERPIDs) && ERPIDs.length > 0) {
		dataSetHana = await srvTx.run(SELECT.from(entity).where({
			ERPID: {
				in: ERPIDs
			}
		}))
	} else {
		dataSetHana = await srvTx.run(SELECT.from(entity))
	}

	return dataSetHana.map((dataHana) => {
		if (dataHana.hasOwnProperty("objActions")) {
			delete dataHana.objActions
		}
		return dataHana
	})

}

//	GET SET ERP 
const getSetERP = async (req, entityName, lastSynch, objID) => {
	//	Get Config and Master Data from ERP	

	var ERPID
	if (objID) {
		ERPID = await getERPIDByID(req, entityName, objID)
	}

	const entity = req.synch.srv.entities[entityName]

	//	Get all compositions and add them to the expand list
	var expands = []
	for (const property in entity.elements) {
		if (entity.elements[property].type === "cds.Composition") {
			expands.push(property)
		}
	}

	try {
		return await getDataFromERP(entityName, lastSynch, expands, ERPID)
	} catch (err) {
		redfigError = errorHandleAddThrow(err, 500, "Error during API call to back-end ERP")
	}

}

//	GET TEST DATA FROM FILE
const getTestDataFromFile = async (entityName, lastSynch) => {
	var json = require("../testPayloads/" + entityName)

	if (json.d.results == undefined) {
		throw new redfigError(500, "Could not find JSON file for" + entityName)
	}

	var results = json.d.results

	if (lastSynch) {
		results = results.filter(entry => {
			return entry.CreatedDate >= lastSynch || entry.ChangedDate >= lastSynch
		})
	}

	return results
}

//	SPLIT LOG ENTRIES
const splitLogEntries = (log, dataSetERP) => {
	/*	
	 *	Returns: logs - Table of Log Entries that will be updated to DataSynchLog
	 */

	var logs = []

	dataSetERP.forEach((dataERP) => {
		const newLog = {}
		newLog.tenant = log.tenantID
		newLog.objectType_ID = log.objectType_ID
		newLog.ObjectID = dataERP.ID //ID of Object that needs to synch (ex: Notificaiton Number), can be *
		newLog.SynchStatus = "S"
		newLog.Message = dataERP.ERPID
		logs.push(newLog)
	})
	return logs
}