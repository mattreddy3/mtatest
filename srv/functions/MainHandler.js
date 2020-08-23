"use-strict";
// This file contains all functions that are relevant for Notifications

//	IMPORTS
const cds = require("@sap/cds")
const {
	deepClone,
	shallowClone,
	// getUserRoles,
	olavoValidateRequiredFields,
	getEntityNameFromTarget
} = require("../utils/hookUtils")

const {
	redfigError,
	errorHandleAddThrow,
	errorHandleAdd,
	// stringfy
} = require("../utils/redfigError")

const {
	dataSynch
} = require("./DataSynchFunctions")



//----------------------------------------------------------------------------------------------------------------
//	"PUBLIC" FUNCTIONS - Functions that are available outside of this file
//----------------------------------------------------------------------------------------------------------------


//	READ DATA
const readData = async (req) => {
	//	This function replaces the generic READ Handler
	//	The main advantage is that it automatically expads the child entities
	//		which are required to determine header fields
	//	Select from the main DB, return if nothing found
	const dbTx = cds.transaction(req)

	// console.log(JSON.stringify(`${req.user.id} has scopes:`))
	// req.attr.hasOwnProperty("scopes") &&
	// console.log(JSON.stringify(req.attr.scopes.map(f => f.split(".")[1]).filter(t => t && t.startsWith("REDFIG"))))

	var dataSet = await dbTx.run(req.query)

	if (dataSet.length === 0 || dataSet[0].hasOwnProperty("counted")) {
		return req.reply(dataSet)
	}

	dataSet = await expandDataSet(req, dataSet)

	return req.reply(dataSet)

}


//	GET DATA
const getData = async (req, input, entityName) => {
	//	This function makes a READ call for Notifications (using the full service)
	//	The input can be a specific ID or an array of ID's


	var dataIDs = []
	if (Array.isArray(input) == true) {
		dataIDs = input
	} else {
		dataIDs.push(input)
	}

	var entity
	if (entityName) {
		entity = req.srv.entities[entityName]
	} else {
		entity = req.target
	}

	//	Get Data object header
	// const data = await req.srvTx.run(SELECT.from(entity).where({	ID: { in : dataIDs }}) )
	var data = await req.dbTx.run(SELECT.from(entity).where({
		ID: {
			in: dataIDs
		}
	}))

	// Expand and Augment any children
	if (data.length > 0) {
		data = await expandDataSet(req, data, entity)
	}

	return data
}

//	READ ACTIONS
const readActions = async (req) => {
	const ID = req.params[0] // TODO: get actual notificationID number
	req.target = req.doc.mainEntity
	// have to set target to Notifications
	// const srv = cds.connect.to("NotificationService") //Connect to Notification Service to get Entities

	// const {Notifications} = srv.entities
	// req.srv = srv
	// req.srvTx = srv.transaction(req)
	// req.target = Notifications
	const data = await getData(req, ID)
	return data[0].objActions
}


//	PRE-PROCESS
const preProcess = async (req, next) => {
	//	ON event for Create, Update and Action process
	//		This funciton cannot be placed in the BEFORE event, as it requires the results of the 
	//		bootstrap functions, which are in a BEFORE event. Since BEFORE events are always done in parallel
	//	Two main activities take place here:
	//		1. Quick valiation of inputs
	//		2. Retrieve the current state of the data from the DB, and place it	into req.dataDB

	try {
		//	STEP 1 - Quick Input Validation
		const requiredFields = await req.doc.getRequiredFields(req)
		req = await olavoValidateRequiredFields(req, req.data, requiredFields)

		//	STEP 2 - Retrieve current data
		//		We get the main data object, even if the call being made is for one of the childrew
		//		EX: if OrderMovements is a child entity of Orders, and we make a POST call on OrderMovements
		//			we still want to retrieve the full Orders object here into req.dataDB
		req.dataDB = await getDataMainEntity(req)

	} catch (err) {
		const redfigError = errorHandleAdd(err, 400, "Error during pre-processing checks")
		return req.reject(400, redfigError.stringfy())
	}

	return next()
};


//	PROCESS
const process = async (req, next) => {

	//	This function replaces the Generic On Handler for CREATE, UPDATE and Actions

	try {

		//	STEP 1 - Check authorizations for what the user is trying to do
		await checkActionAuthorization(req, req.dataDB)

		//	STEP 2 - Merge Child Data from the UI into it's main element
		//		EX: For ORder Movements, merge data into dataDB, then pass it into the function below
		var dataDBNew = mergeIntoMainDataStructure(req, req.data)

		//	STEP 3 - Apply business rules to dataDBNew object
		await req.doc.applyBusinessRules(req, dataDBNew)

		//	AT THIS POINT, we are only working with dataDBNew, which corresponds to the entire Deep Structure of the object
		//		even if the UI CRUD call was for a sepcific child object
		//		EX: req.data could be a Movement, but dataDBNew will be the entire Order object

		//	STEP 4 - Run an Update/Check on ERP
		//		If the next status is not DRAFT, we check against the back-end ERP if one is configured.
		//		This could be done in simulate mode for error checking, or it could update ERP directly at this time
		//		this is determine based on the synching method, see the upserERP for this logic
		//		eitherway, a data structure is returned since the back-end ERP could mofify additional fields that we
		//		did not specify in our update call
		if (dataDBNew.updateERP) {
			req.synchObj = await getSynchObj(req, "OUT") //	Get the relenant synch job, if configured

			if (req.synchObj) {
				dataDBNew = await upsertERP(req, dataDBNew) // Call back-end ERP
			}
		}

		dataDBNew.tenantID = req.tenantID // Always set tenant ID
		delete dataDBNew.actionName // Action Name is not a collumn in the DB
		delete dataDBNew.updateERP
		delete dataDBNew.objActions // No need to update here
		delete dataDBNew.LastSynch

		var event = req.event
		if (req.doc.mainEntityName !== getEntityNameFromTarget(req.target)) {
			event = "UPDATE"
		}

		// const dataIn = Object.assign( {}, dataDBNew)
		const dataIn = deepClone(dataDBNew)


		await handleDeepUpsert(req, req.doc.mainEntity, dataIn, event)

		//	We tried to return the entire READ service in the repsonse payload (included exnded and augmented fields)
		//	however, we weren't able to get the srvTx call to work with the getData funciton
		//	const dataOut = await getData(req, req.data.ID) 
		//	return req.reply(dataOut)

		//	For now, just return the data that was passed in with the success call
		//	the UI will need to make an additional READ call immediately after to return all of the updated values
		return req.reply(req.data)
		// return next()

	} catch (err) {
		const redfigError = errorHandleAdd(err, 400, "Error during processing checks")
		return req.reject(400, redfigError.stringfy())
	}
}

//	POST PROCESS
const postProcess = async (data, req) => {
	/*	
	 *		Import:	
	 *			data		- Data that was just updated/creatded on the HANA DB
	 *			req 		- Standard Request Object for Notification
	 *		Return:	
	 *						- None
	 */

	//	Two possible methods for Outbound synching to ERP
	//		R - Real-time, ERP should have alredy been updated in pre-processing
	//		P - Periodic, update ERP with the next batch job

	if (req.synchObj && req.synchObj.Method === "P") {
		await addPendingLogEntry(req, req.synchObj, data)
	}

	// req.dbTx.commit(true)

};

// EXPORT - These are the "Public" functions we can export
module.exports = {
	readData, //Run expanded service to READ (using req as input)
	getData, //Run expanded service to READ (using Notificaion ID's as input)
	preProcess, //Pre-processing steps
	process, //Process Status Changes to Notification
	postProcess, //Post Processing Steps
	readActions // getter for object actions, reuses logic from getNotifications
};

//----------------------------------------------------------------------------------------------------------------
//	"PRIVATE" FUNCTIONS - functions that can only be called from within the file
//----------------------------------------------------------------------------------------------------------------

const handleDeepUpsert = async (req, entity, dataIn, event) => {

	var dataOut = deepClone(dataIn)
	var dataObjSet = []

	const elements = shallowClone(entity.elements)

	removeServiceProperties(entity) //Remove elements that are not defined at the DB level

	for (const property in dataOut) {
		const element = entity.elements[property]
		if (!element) {
			delete dataOut[property] //Delete property that is not on the DB
		} else if (element.type === "cds.Composition" && dataOut[property].length > 0) {
			const dataObj = {}
			dataObj.dataSet = dataOut[property].map(line => line) //Map itselt to create new array
			dataObj.name = element.name
			dataObj.entity = req.srv.entities[getEntityNameFromTarget(element.target)]
			dataObjSet.push(dataObj)

			delete dataOut[property] //Now Delete the Array from the header data set
		}
	}

	//	Reassign original version of elements
	entity.elements = elements

	//Update the header data set
	if (!event) {
		const checkExists = await req.dbTx.run(SELECT.from(entity).where({
			ID: dataOut.ID
		}))
		if (checkExists.length > 0) {
			event = "UPDATE"
		} else {
			event = "CREATE"
		}
	}

	delete dataOut.createdAt
	delete dataOut.createdBy
	delete dataOut.modifiedAt
	delete dataOut.modifiedBy

	try {
		var result = {}
		if (event === "CREATE") {
			result = await req.dbTx.run(INSERT.into(entity).entries(dataOut))
		} else {
			result = await req.dbTx.run(UPDATE(entity).data(dataOut).where({
				ID: dataOut.ID
			}))
		}
	} catch (err) {
		redfigError = errorHandleAddThrow(err, 500, "Error updating entity " + entity)
	}

	//Now Upsert child entries
	dataObjSet = await Promise.all(dataObjSet.map((dataObj) => {
		dataObj.dataSet = dataObj.dataSet.map((data) => {
			data = handleDeepUpsert(req, dataObj.entity, data)
			return data
		})
		return dataObj
	}))

	//Re-merge child entries into Header Structure
	dataObjSet.forEach((dataObj) => {
		dataOut[dataObjSet.name] = dataObj.dataSet
	})

	return dataOut
}

//	REMOVE SERVICE PROPERTIES
const removeServiceProperties = (entity) => {
	//
	//	This functions removes any element from the entity that is defined at the service level 
	//	and is not actually a field on the corresponding Data Base table

	entity.query.SELECT.columns.forEach((collumn) => {
		if (typeof collumn === "object" && collumn.as) {
			delete entity.elements[collumn.as]
		}
	})

	//Remove Virtual Elements
	for (const prop in entity.elements) {
		if (entity.elements[prop].virtual === true) {
			delete entity.elements[prop]
		}
	}

}

//	GET DATA MAIN ENTITY
const getDataMainEntity = async (req) => {

	//	This function return the main data oject, even if the request target is an underlying child 
	//		EX: the UI is making a POST call on OrderMovements, we still return the entire expanded Orders object
	//	this is useful for doing comparisons duing the pre-processing checks

	var headerID

	//	Compare the entity being passed in against the main entity for this service
	//		EX: Orders vs. OrdersMovements
	if (req.doc.mainEntity.name !== req.target.name) {
		//	IF they are different, get the parent ID from the child entry and use that 
		//	as the headerID to get the main object below
		var parentPropName = findParentProperty(req.doc.mainEntity.name, req.target.elements)
		headerID = req.data[parentPropName]

	} else if (req.event != "CREATE") {
		//IF they are the same, and we are not creating the main object( ex: not creating an Order)
		//	then we just use the ID being passed in go get the main object below
		if (!req.data.ID) {
			req.data.ID = req.params[0]
		}
		headerID = req.data.ID
	}

	//	Get the main object from the DB
	if (headerID) {
		//	Get Main Object from Service, Equivalent to a GET call with expanded children
		const dataSet = await getData(req, headerID, req.doc.mainEntityName)

		if (!dataSet) {
			throw new redfigError(500, "Could not locate" + req.entity)
		}
		return dataSet[0]
	}
}

//	EXPAND DATA SET	
const expandDataSet = async (req, dataSet, entity) => {

	//	Get all ID's data Set
	const dataIDs = dataSet.map(data => data.ID)

	if (!entity) {
		entity = req.target
	}

	//	Get compositions that are part of this entity
	//		ex: NotificationItems is a composition for Notifications
	//	Also get all corresponding data where the parent ID is in dataIDs
	//		For example, get all NotificationItems for the Notificaitons selected above
	const comps = await getCompositions(req, entity, dataIDs)

	//	Object Actions are special, so fetch them separately via the ObjType (ex: NH, or WO)
	const {
		ObjActions
	} = req.srv.entities
	const objActions = await req.dbTx.run(SELECT.from(ObjActions).where({
		ObjectType: req.doc.type
	}))

	//	Map all of the child datasets to their parent
	dataSet.forEach((data) => {
		comps.forEach((comp) => {
			// data[comp.entityName] = comp.dataSet.filter( child => child[comp.parentPropName] == data.ID )
			data[comp.name] = matchChildEntries(comp.dataSet, comp.parentPropName, data.ID, comp.comps)
		})
		data.objActions = objActions
	})

	//	AT THIS POINT, dataSet should contain all header level objects/documents, as well as
	//	every possible child expansions (compositions)

	//	Add Auxiliary Values
	dataSet = dataSet.map(data => {
		return req.doc.augment(req, data)
	})

	return dataSet
};

//	CHECK SYNCH METHOD
const getSynchObj = async (req, direction) => {

	const srv = await cds.connect.to("SynchService")
	const srvTx = srv.transaction(req)

	const {
		DataSynchObjects
	} = srv.entities

	const synchObjs = await srvTx.run(SELECT.from(DataSynchObjects).where({
		EntityName: req.doc.mainEntityName,
		Direction: direction
	}))

	return synchObjs[0]

}

//	GET COMPOSITIONS
const getCompositions = async (req, entity, parentIDs) => {
	//	Returns an array of compositions for a given entity
	//	which includes any lower level compositions as well (recursive)
	const comps = []

	for (const property in entity.elements) {
		if (entity.elements[property].type === "cds.Composition") {
			const comp = {}
			comp.name = property
			comp.entityName = getEntityNameFromTarget(entity.elements[property].target)
			comp.entity = req.srv.entities[comp.entityName]

			//	Get the Data Set for child entries
			comp.parentPropName = findParentProperty(entity.name, comp.entity.elements)
			// const query = addWhereClauseToQuery( comp.entity.query, comp.parentPropName, parentIDs  )
			// comp.dataSet = await req.dbTx.run(query)
			// comp.dataSet = await req.srvTx.run(query)

			const where = {}
			where[comp.parentPropName] = {}
			where[comp.parentPropName].in = parentIDs

			//	RABBIT HOLE!!
			//	For some rason, I could no use req.srvTx, instead, need to create a new version of srvTx
			//	when using req.srvTx, it was not returning results that were updates in a previous POST call until you re-started the service
			//	not sure why, but this was causing major issues
			//	Also, using req.dbTx was not an option because we need to retrieve auxiliary fields defined at the service level

			// comp.dataSet = await req.srvTx.run(SELECT.from(comp.entity).where( where ))
			const srv = await cds.connect.to(req.mainService)
			const srvTx = srv.transaction(req)
			comp.dataSet = await srvTx.run(SELECT.from(comp.entity).where(where))


			//	Get all IDs for the entries just retrieved, and get all child objects in Recursion
			const childIDs = comp.dataSet.map((data) => data.ID)
			if (childIDs) {
				comp.comps = await getCompositions(req, comp.entity, childIDs)
			}

			comps.push(comp)
		}
	}

	return comps
}


const findParentProperty = (parentEntityTarget, elements) => {

	for (const propName in elements) {
		const propValue = elements[propName]
		if (propValue.type === "cds.Association" && propValue.target === parentEntityTarget) {
			return propValue.name + "_ID"
		}
	}
}


const matchChildEntries = (dataSet, parentPropName, ID, comps) => {

	const dataSetOut = dataSet.filter((data) => data[parentPropName] === ID).map((dataOut) => {
		comps.forEach((comp) => {
			dataOut[comp.entityName] = matchChildEntries(comp.parentPropName, dataOut.ID, comp.comps)
		})
		return dataOut
	})

	return dataSetOut
}

//	ADD PENDING LOG ENTRY
const addPendingLogEntry = async (req, synchObj, data) => {

	const dbTx = cds.transaction(req)
	const srv = await cds.connect.to("SynchService")

	const {
		DataSynchLog
	} = srv.entities

	const newLogEntry = {}
	newLogEntry.tenantID = req.tenantID //	Get the correct Tenant ID
	newLogEntry.objectType_ID = synchObj.ID //	Synch Object Type
	newLogEntry.ObjectID = data.ID
	newLogEntry.SynchStatus = "P"
	newLogEntry.Message = "Outbound Synch Pending"

	try {
		//make sure entry is not already in DB
		const results = await dbTx.run(SELECT
			.from(DataSynchLog)
			.where({
				tenantID: newLogEntry.tenantID,
				objectType_ID: newLogEntry.objectType_ID,
				ObjectID: newLogEntry.ObjectID,
				SynchStatus: "P"
			})
		)

		if (!results || results.length === 0) {
			await dbTx.run(INSERT.into(DataSynchLog).entries(newLogEntry))
		}
	} catch (err) {
		redfigError = errorHandleAddThrow(err, 500, "Post-Processing error adding to Synch Log")
	}
}

//	UPSERT ERP 
const upsertERP = async (req, dataIn) => {
	//	This function synchs changes made in this application to a third-party ERP system (if configured)

	//	Two possible methods for Outbound synching to ERP
	//		R - Real-time, update ERP now
	//		P - Periodic, update ERP with the next batch job
	var simulate = true
	if (req.synchObj.Method === "R" || dataIn.updateERP === 2) {
		simulate = false
	}

	try {
		const dataOut = await dataSynch(req, simulate, req.doc.mainEntity, dataIn.ID, dataIn)
		return dataOut

	} catch (err) {
		redfigError = errorHandleAddThrow(err, 400, "Error validating Change against back-end ERP")
	}

};

//	MERGE INTO MAIN DATA STRUCTURE
const mergeIntoMainDataStructure = (req, data) => {

	const entityNameIn = getEntityNameFromTarget(req.target)
	var dataOut = {}

	if (entityNameIn === req.doc.mainEntityName) {
		if (req.dataDB) {
			//dataOut = deepClone(dataIn)
			dataOut = Object.assign(req.dataDB, data)
		} else {
			dataOut = deepClone(data)
			// dataOut = Object.assign( {}, data)
		}

	} else {
		// dataOut = Object.assign( {}, req.dataDB)
		dataOut = deepClone(req.dataDB)

		if (dataOut.ERPID) {
			dataOut.ERPFunction = "U"
		} else {
			dataOut.ERPFunction = "I"
		}

		dataOut.updateERP = data.updateERP

		const elements = req.doc.mainEntity.elements
		var compProp

		for (const prop in elements) {
			if (elements[prop].type === "cds.Composition" && elements[prop].target === req.target.name) {
				compProp = prop //Ex: Movements
			}
		}

		//	See if the Child Line (EX: Movement) being posted is already part of this object
		//	IF it is, just update that corresponding line with the need structure
		//		ex: Orders/Movements
		var lineFound = false
		dataOut[compProp].forEach((childLine) => {
			if (childLine.ID === data.ID) {
				childLine = data
				lineFound = true
			}
		})

		//THIS WOULD HAVE TO BE UPDATED AT THE CHILD ENTITY
		if (data.ERPID) {
			data.ERPFunction = "U" //	Already exists in ERP, Update
		} else {
			data.ERPFunction = "I" //	Does not exist in ERP, Insert
		}

		//	If it's not found, then we append it
		if (!lineFound) {
			dataOut[compProp].push(data)
		}
	}
	return dataOut
}

//	CHECK ACTION AUTHORIZATION
const checkActionAuthorization = async (req, dataDB) => {

	// Determine the action that is taking place form the UI
	const objActions = getActionFromReq(req)
	const actionName = objActions.ActionName

	//	If No Notification (dataDB) is passed in, that means that this Document
	//	does not yet exist, don't return error
	if (!dataDB) {
		return
	}

	if (dataDB && !dataDB.objActions) {
		throw new redfigError(400, "No Actions allowed for this document")
	}

	//	Make sure that the action that was passed in is available for this notification
	const [objAction] = dataDB.objActions.filter(action => {
		return action.ActionName == actionName
	})

	if (objAction === undefined) {
		throw new redfigError(400, "Action not Allowed for this document")
	}

	return
}

//	GET ACTION FROM REQ
const getActionFromReq = (req) => {

	const entityName = req.target.name.split(".")[1]

	const objActions = req.doc.possibleActions.filter((objAction) => {

		//	Make sure the event and the Entity NAme match
		if (objAction.ActionEvent !== req.event || objAction.ActionEntity !== entityName) {
			return false
		}
		//	IF the event = "process", this is an action so we need to change the action naem as well
		if (req.event === 'process') {
			return req.data.actionName === objAction.ActionName
		} else {
			return true
		}
	})

	if (objActions.length === 0) {
		throw new redfigError(400, "Action not recgonized")
	} else if (objActions.length > 1) {
		throw new redfigError(500, "Could not determine action")
	} else {
		return objActions[0]
	}

}