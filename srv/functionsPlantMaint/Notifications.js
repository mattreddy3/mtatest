"use-strict";
// This file contains all functions that are relevant for Notifications

//	IMPORTS
const cds = require("@sap/cds")

const {
	getUserRoles,
	olavoValidateRequiredFields,
	getTenantID
} = require("../utils/hookUtils")

const {
	redfigError,
	errorHandleAddThrow,
	errorHandleAdd,
	stringfy
} = require("../utils/redfigError")

//	CONSTANTS
const notificationStatuses = {}
notificationStatuses.draft = 01
notificationStatuses.open = 10
notificationStatuses.orderAssigned = 20;
notificationStatuses.completed = 50;
notificationStatuses.cancelled = 90;

const notifObjType = "NH"
const mainService = "NotificationService" //Main Service (Other than DB)
const mainEntityName = "Notifications" //Main Entity for this service


const bootstrapReq = async (req) => {

	req.tenantID = await getTenantID()
	req.dbTx = cds.transaction(req)
	req.mainService = mainService
	req.srv = await cds.connect.to(mainService) //Connect to Order Service to get Entities
	req.srvTx = req.srv.transaction(req.srv)

	//	The doc object will hold all variables and functions related to this specific document (Orders)
	req.doc = {}
	req.doc.type = notifObjType
	req.doc.mainEntityName = mainEntityName
	req.doc.mainEntity = req.srv.entities[mainEntityName]

	try {
		const {
			ObjActions
		} = req.srv.entities
		req.doc.possibleActions = await req.dbTx.run(SELECT.from(ObjActions).where({
			ObjectType: notifObjType
		}))
	} catch (error) {
		throw new redfigError(500, "Error Determining Possible Actions")
	}

	//	Add Object functions, which are called form the MainHandler.js
	req.doc.getRequiredFields = getRequiredFields
	req.doc.applyBusinessRules = applyBusinessRules
	req.doc.augment = augment

	return req
}

// EXPORT - These are the "Public" functions we can export
module.exports = {
	bootstrapReq
};


const getRequiredFields = (req) => {

	const requiredFields = []

	if (req.event === "CREATE") {
		requiredFields.push({
			key: "notificationType_ID",
			desc: "Notification type"
		})
	}

	return requiredFields
}


//	APPLY BUSINESS RULES
const applyBusinessRules = (req, notification) => {
	//	Importing:
	//		req 			- Request Object coming from the UI, where req.data is what will be saved to HANA
	//							This is for REFERENCE ONLY
	//		notification	- The entire object, including req.data merged into it
	//	Returning:
	//		notification	- Entire notification object, as it's going to be sent to back-end ERP And updated to DB
	//	
	//	Description:
	//		
	//		This function allows you to make any last minute changes to the entire "notifications" object before updating ERP and HANA
	//		This object already has the updates from the UI merged into it

	var action
	if (req.data.actionName) {
		action = notification.objActions.find(act => act.ActionName === req.data.actionName)
	}

	//	RULE 1: When Creating a Notification, always set Status to draft
	if (req.event === "CREATE") {
		notification.NotificationStatus = notificationStatuses.draft

		//	Also make sure the user can do this
		if (!req.user.is("REDFIG_W_NOTIF_CREATE")) {
			throw new redfigError(400, "No Authorization to Create Notification")
		}
	}

	//	RULE 2: If processing an action, determine the new status
	if (req.event === "process" && action.NewStatus) {
		notification.NotificationStatus = action.NewStatus
	}

	//	RULE 3 - if there is no status on the data coming in, set the status to the current status from the DB			
	if (!notification.NotificationStatus && req.dataDB) {
		notification.NotificationStatus = req.dataDB.NotificationStatus
	}

	//	RULE 4 - set the Update ERP flag based on the status
	//			 update ERP unless it's in draft status
	if (notification.NotificationStatus != notificationStatuses.draft) {
		notification.updateERP = 1 //	Standard, simulate flag is driven off of Synch Object Configuration
		if (action && action.ActionName === "UPDATE_ERP") {
			notification.updateERP = 2 //	Update ERP with simulate = false, done in manual cases
		}
	}

	//	RULE 5: If we are Processing the Notification, or we are updating it, several fields are required)
	if (req.event === "process" || (req.method === "PUT" && notification.NotificationStatus !== notificationStatuses.draft)) {
		// in process
		//Check required fields
		var fields = [{
				key: "functionalLocation_ID",
				desc: "Functional location"
			},
			{
				key: "priorityCode_ID",
				desc: "Priority"
			},
			{
				key: "Reporter",
				desc: "Reporter"
			},
			{
				key: "RequiredStartDateTime",
				desc: "Required start"
			},
			{
				key: "RequiredEndDateTime",
				desc: "Required end"
			},
			{
				key: "ShortText",
				desc: "Description"
			}
		]
		const errorReq = olavoValidateRequiredFields(req, notification, fields)
		if (errorReq.errors) {
			const errorMessage = errorReq.errors.reduce((msg, err) => {
				msg = msg + ", " + err.message
				return msg
			}, " ")
			throw new redfigError(400, errorMessage)
		}

		if (notification.RequiredStartDateTime > notification.RequiredEndDateTime) {
			throw new redfigError(400, "End Date cannot be before Start Date")
		}
	}


	// RULE 6: Assign New Text Item to Text Conversation
	if (notification.LongText) {
		var notificationText = {}
		notificationText.notification_ID = notification.ID
		notificationText.ERPFunction = "I"
		notificationText.Source = "APP"
		notificationText.DateTime = Date.now()
		notificationText.LongText = notification.LongText
		notification.NotificationTexts.push(notificationText)

		delete notification.LongText
	}

	//	RULE 7: Set ERPFunction Flag
	if (notification.updateERP) {
		if (req.data.ERPID || notification.ERPID) {
			notification.ERPFunction = "U" //	Already exists in ERP, Update
		} else {
			notification.ERPFunction = "I" //	Does not exist in ERP, Insert
		}
	}

};


//	AUGMENT
const augment = (req, notification) => {

	//Calculate Header Values based on Items
	runCalculations(notification)

	//Determine Actions Available
	determineNotificationActions(req, notification)

	//Add Status Description
	addStatusDescription(notification)

	//Texts
	notification.NotificationTexts.map(text => {

		if (!text.DateTime) {
			text.DateTime = text.createdAt
		}

		return text
	})

	if (notification.ERPID) {
		notification.NotificationNo = notification.ERPID
	} else {
		notification.NotificationNo = notification.ID.substring(0, 8)
	}

	return notification;
}

//	RUN CALCULATIONS
const runCalculations = async notification => {
	// This function calculates values in the header section that are aggregated from 
	// item values in a deep structure

};

// DETERMINE ACTIONS
const determineNotificationActions = async (req, notification) => {
	//Actions are dependedent on specific attributes of a Notification
	//	such as Status, user athorization, other standard/customer business logic
	//this code is used to activate/deactivate actions
	const allowedActions = []

	//	Set allowed actions based on current status
	switch (notification.NotificationStatus) {
		case notificationStatuses.draft: //Draft -> SAVE or DELETE
			allowedActions.push("SUBMIT")
			allowedActions.push("DELETE")
			allowedActions.push("UPDATE")
			break;

		case notificationStatuses.open: //Open -> CONVERT or CANCEL
			// allowedActions.push("CONVERT")
			allowedActions.push("CANCEL")
			allowedActions.push("UPDATE")
			allowedActions.push("UPDATE_ERP") // Synch tO ERP
			break;
		case notificationStatuses.orderAssigned: //Assigned -> No follow-on actions at this point
			allowedActions.push("UPDATE_ERP") // Synch tO ERP
			break;
		case notificationStatuses.completed: //Completed -> No follow-on actions at this point
			allowedActions.push("UPDATE_ERP") // Synch tO ERP
			break;
		case notificationStatuses.cancelled: //Cancelled -> REOPEN
			allowedActions.push("REOPEN")
			allowedActions.push("UPDATE_ERP") // Synch tO ERP
			break;
	}

	const userRoles = await getUserRoles() //TODO Put this in the before event

	// Remove Actions that are not allowed or the user doesn't have authorization to perform
	notification.objActions = notification.objActions.filter((action) => {
		if (!allowedActions.includes(action.ActionName)) { // First - make sure this action is allowed
			return false
		}

		if (action.Scope === "NA") { // Second - No Authroization Required for this action
			return true
		}

		//	If this order was not created by this user, make sure this user can view other 
		if (notification.createdBy !== req.user.id) {
			if (!req.user.is("REDFIG_W_NOTIF_PROCESS_OTHERS")) {
				return false
			}
		}

		//	Finaly - make sure this user has the correct scope
		return req.user.is(action.Scope)
	})

	return notification
};

//	ADD STATUS DESCRIPTION
const addStatusDescription = async notification => {

	//TODO - Make this dynamic based on data-model type
	switch (notification.NotificationStatus) {
		case 1:
			notification.NotificationStatusDesc = "Draft"
			break;
		case 10:
			notification.NotificationStatusDesc = "Open"
			break;
		case 20:
			notification.NotificationStatusDesc = "Order Assigned"
			break
		case 50:
			notification.NotificationStatusDesc = "Completed"
			break
		case 90:
			notification.NotificationStatusDesc = "Cancelled"
			break
	}

}