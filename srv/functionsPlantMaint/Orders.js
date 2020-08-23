"use-strict";
// This file contains all functions that are relevant for Orders

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
const orderStatuses = {}
orderStatuses.draft = 01;
orderStatuses.open = 10;
orderStatuses.released = 20;
orderStatuses.partConfirmed = 30;
orderStatuses.finalConfirmed = 30;
orderStatuses.completed = 50;
orderStatuses.deleted = 90;

const orderObjType = "OH"
const mainService = "WorkOrderService" //Main Service (Other than DB)
const mainEntityName = "Orders" //Main Entity for this service


const bootstrapReq = async (req) => {


	req.tenantID = await getTenantID()
	req.dbTx = cds.transaction(req)
	req.mainService = mainService
	req.srv = await cds.connect.to(mainService) //Connect to Order Service to get Entities
	// TODO: req.srv.transaction is not a function
	req.srvTx = req.srv.tx(req.srv)

	//	The doc object will hold all variables and functions related to this specific document (Orders)
	req.doc = {}
	req.doc.type = orderObjType
	req.doc.mainEntityName = mainEntityName
	req.doc.mainEntity = req.srv.entities[mainEntityName]

	try {
		const {
			ObjActions
		} = req.srv.entities
		req.doc.possibleActions = await req.dbTx.run(SELECT.from(ObjActions).where({
			ObjectType: orderObjType
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


//	GET REQUIRED FIELD
const getRequiredFields = (req) => {

	const requiredFields = []
	const entity = req.target.name.split(".")[1]

	switch (entity) {
		case "Orders":
			if (req.event === "CREATE") {
				requiredFields.push({
					key: "orderType_ID",
					desc: "Order type"
				})
			}
			break

		case "OrderMovements":
			break

		case "OrderConfirmations":
			break
	}

	return requiredFields
}


//	APPLY BUSINESS RULES
const applyBusinessRules = (req, order) => {
	//	Importing:
	//		req 			- Request Object coming from the UI, where req.data is what will be saved to HANA
	//							this could be the entire Order oject (for /Orders) calls, 
	//							or it could be just the OrderMoevements or OrderConfirmations call
	//							THIS ShOULD BE USED FOR REFERENCE ONLY
	//		order			- The entire object, including req.data merged into it
	//	Returning:
	//		order			- Entire order object, as it's going to be sent to back-end ERP And updated to DB
	//	
	//	Description:
	//		This function allows you to make any last minute changes to the entire "order" object before updating ERP and HANA
	//		This object already has the updates from the UI merged into it

	const entity = req.target.name.split(".")[1]
	switch (entity) {
		case "Orders":
			applyBusinessRulesOrder(req, order)
			break

		case "OrderMovements":
			applyBusinessRulesMovements(req, order)
			break

		case "OrderConfirmations":
			applyBusinessRulesConfirmations(req, order)
			break

		case "OrderComponents":
			applyBusinessRulesComponents(req, order)
			break
	}

};

//	APPLY BUSINESS RULES ORDER
const applyBusinessRulesOrder = (req, order) => {

	var action
	if (req.data.actionName) {
		action = order.objActions.find(act => act.ActionName === req.data.actionName)
	}

	//	RULE 1: When Creating a Order, always set Status to draft
	if (req.event === "CREATE") {
		order.OrderStatus = orderStatuses.draft

		if (!req.user.is("REDFIG_W_WORDER_CREATE")) {
			throw new redfigError(400, "No Authorization to Create Work Order")
		}
	}

	//	RULE 2: If processing an action, determine the new status
	if (req.event === "process" && action.NewStatus) {
		order.OrderStatus = action.NewStatus
	}

	//	RULE 3 - if there is no status on the data coming in, set the status to the current status from the DB			
	if (!order.OrderStatus && req.dataDB) {
		order.OrderStatus = req.dataDB.OrderStatus
	}

	//	RULE 4 - set the Update ERP flag based on the status
	//			 update ERP unless it's in draft status
	if (order.OrderStatus != orderStatuses.draft) {
		order.updateERP = 1 //	Standard, simulate flag is driven off of Synch Object Configuration
		if (action && action.ActionName === "UPDATE_ERP") {
			order.updateERP = 2 //	Update ERP with simulate = false, done in manual cases
		}
	}

	//	RULE 5: Required Fields
	if (req.event === "process" || (req.method === "PUT" && order.OrderStatus !== orderStatuses.draft)) {
		var fields = [{
				key: "functionalLocation_ID",
				desc: "Functional Location"
			},
			{
				key: "priorityCode_ID",
				desc: "Priority"
			},
			{
				key: "workCenter_ID",
				desc: "Work Center"
			},
			{
				key: "RequiredStartDateTime",
				desc: "Required Start"
			},
			{
				key: "RequiredEndDateTime",
				desc: "Required End"
			}
		]
		const errorReq = olavoValidateRequiredFields(req, order, fields)
		if (errorReq.errors) {
			const errorMessage = errorReq.errors.reduce((msg, err) => {
				msg = msg + ", " + err.message
				return msg
			}, " ")
			throw new redfigError(400, errorMessage)
		}

		if (order.RequiredStartDateTime > order.RequiredEndDateTime) {
			throw new redfigError(400, "End Date cannot be before Start Date")
		}

	}

	//	RULE 6: Set ERPFunction Flag
	if (order.updateERP) {
		if (req.data.ERPID || req.dataDB.ERPID) {
			order.ERPFunction = "U" //	Already exists in ERP, Update
		} else {
			order.ERPFunction = "I" //	Does not exist in ERP, Insert
		}
	}
}


//	APPLY BUSINESS RULES MOVEVEMENTS
const applyBusinessRulesMovements = (req, order) => {
	order.updateERP = 1 //Always update ERP when posting a goods movement
}

const applyBusinessRulesComponents = (req, order) => {

	order.updateERP = 1

	var fields = [{
			key: "workOrder_ID",
			desc: "Order number"
		},
		{
			key: "orderOperation_ID",
			desc: "Operation number"
		},
		{
			key: "material_ID",
			desc: "Material number"
		}
	]
	const errorReq = olavoValidateRequiredFields(req, req.data, fields)
	if (errorReq.errors) {
		const errorMessage = errorReq.errors.reduce((msg, err) => {
			msg = msg + ", " + err.message
			return msg
		}, " ")
		throw new redfigError(400, errorMessage)
	}

	//Set ERP Function Flag


}

//	APPLY BUSINESS RULES CONFIRMATIONS
const applyBusinessRulesConfirmations = (req, order) => {

	//Check required fields
	if (!req.data.cancelledConfirmation_ID) {
		var fields = [{
				key: "workOrder_ID",
				desc: "Order number"
			},
			{
				key: "WorkActual",
				desc: "Actual work"
			},
			{
				key: "WorkUoM",
				desc: "Work unit of measure"
			},
			{
				key: "WorkStart",
				desc: "Work start"
			},
			{
				key: "WorkEnd",
				desc: "Work end"
			},
			{
				key: "orderOperation_ID",
				desc: "Operation number"
			}
		]
		const errorReq = olavoValidateRequiredFields(req, req.data, fields)
		if (errorReq.errors) {
			const errorMessage = errorReq.errors.reduce((msg, err) => {
				msg = msg + ", " + err.message
				return msg
			}, " ")
			throw new redfigError(400, errorMessage)
		}
	} else {
		const cancelledConfirmation = order.Confirmations.find((conf) => {
			return conf.ID === req.data.cancelledConfirmation_ID
		})
		if (cancelledConfirmation.Reversed === true) {
			throw new redfigError(400, "Confirmation has already been reversed")
		}
	}

	//	STEP 2 - If we are cancelling a confirmation that has not yet been synched to ERP,
	//				remove the ERPFunction from the original confirmation

	if (req.data.cancelledConfirmation_ID) {
		const cancelledConfirmation = order.Confirmations.find((conf) => {
			return conf.ID === req.data.cancelledConfirmation_ID
		})

		//	If the Cancelled Confirmation has not been updated to ERP yet
		if (cancelledConfirmation && !cancelledConfirmation.ERPID) {

			order.Confirmations = order.Confirmations.map((conf) => {
				if (conf.ID === req.data.cancelledConfirmation_ID) { //Original Confirmation
					conf.ERPFunction = null
					conf.Reversed = true
					conf.ConfirmationText = "Original Conf"
				} else if (conf.ID === req.data.ID) { //Confirmation being added
					conf.Reversed = false
					conf.ERPFunction = null
					conf.ConfirmationText = "Reversee"
				}
				return conf
			})
		}
	}

	//THIS CAN BE SET AT THE ORDER LEVEL
	order.updateERP = 1 //Always update ERP when posting a confirmation
}


//	AUGMENT
const augment = (req, order) => {
	//	This function is used during READ calls in order to add additional context to the data coming from the DB

	//Calculate Header Values based on Items
	runCalculations(order)

	//Determine Actions Available
	determineOrderActions(req, order)

	//Add Status Description
	addStatusDescription(order)

	//TODO - Sort Items Below
	//	Sort order.Components		by OrderComponentNo
	//	Sort order.Operations		by OrderOperationNo
	//	Sort order.Confirmations	by CreatedAt
	//	Sort order.Movements		by CreatedAt

	if (order.ERPID) {
		order.OrderNo = order.ERPID
	} else {
		order.OrderNo = order.ID.substring(0, 8)
	}

	return order;
}

//	RUN CALCULATIONS
const runCalculations = async order => {
	// This function calculates values in the header section that are aggregated from 
	// item values in a deep structure

	//	1 - Calculate Withdrawn Quantity for Component
	order.Components = order.Components.map((comp) => {
		//	Aggregate All Goods Movements to for this Component
		comp.QuantityWithdrawn = order.Movements.reduce((qty, movement) => {
			if (movement.orderComponent_ID === comp.ID) {
				qty = qty + movement.Quantity //TODO - Account for different UoM
			}
			return qty
		}, 0)
		return comp
	})

	//	2 - Calculate worked confirmed for Operation
	order.Operations = order.Operations.map((oper) => {
		//	Aggreage all Work Confirmed in Confirmation to their corresponding operation
		oper.WorkConfirmed = order.Confirmations.reduce((work, confirmation) => {
			if (confirmation.orderOperation_ID === oper.ID && !confirmation.Reversed && !confirmation.cancelledConfirmation_ID) {
				work = work + confirmation.WorkActual
			}
			return work
		}, 0)
		return oper
	})

};

// DETERMINE ACTIONS
const determineOrderActions = async (req, order) => {
	//Actions are dependedent on specific attributes of a Order
	//	such as Status, user athorization, other standard/customer business logic
	//this code is used to activate/deactivate actions
	const allowedActions = []

	//	Set allowed actions based on current status
	switch (order.OrderStatus) {
		case orderStatuses.draft: //Draft -> SUBMIT, UPDATE or DELETE
			allowedActions.push("SUBMIT") // Draft -> Open
			allowedActions.push("UPDATE") // Draft -> Draft
			allowedActions.push("DELETE") // Draft -> Delete
			break;

		case orderStatuses.open:
			allowedActions.push("RELEASE")
			allowedActions.push("UPDATE")
			allowedActions.push("POST_COMP")
			allowedActions.push("PUT_COMP")
			allowedActions.push("DEL_COMP")
			allowedActions.push("DELETE")
			allowedActions.push("UPDATE_ERP") // Synch tO ERP
			break;

		case orderStatuses.released:
			allowedActions.push("POST_MOVE") //Not on bottom toolbar
			allowedActions.push("POST_CONF") //Not on bottom toolbar
			allowedActions.push("UPDATE_ERP") // Synch tO ERP
			allowedActions.push("POST_COMP")
			allowedActions.push("PUT_COMP")
			allowedActions.push("DEL_COMP")
			break;

		case orderStatuses.partConfirmed:
			allowedActions.push("POST_MOVE") //Not on bottom toolbar
			allowedActions.push("POST_CONF") //Not on bottom toolbar
			allowedActions.push("UPDATE_ERP") // Synch tO ERP
			break;

		case orderStatuses.completed:
			allowedActions.push("UPDATE_ERP") // Synch tO ERP
			break; //No allowed actions at this time

		case orderStatuses.deleted:
			break; //No allowed actions at this time
	}


	/*
		Here are some notes on authenticating user groups.
		on the `req`, you can access two properties that are relevant: `.user`, `.attr`
		Best to debug through to get a better sense for what they provide, but the basics are:
		- req.user.is(<scope string>) 
			-Function- 
			This is how you check if the user has a scope
		- req.user.has([<scope1>, <scope2>])
			-Function-
			I haven't tested this, but my assumption based on what i saw, presumably so you can check multiple scopes in one call
		- req.attr.xsappname 
			-String- 
			This is needed as the scopes maintained in the xs-security.json (go there to understand our options)
			file have dynamic names
			**Update** you do not need the "req.attr.xsappname" dynamic value for checking a scope
			provided by this MTA's xs-security.json file
		- req.attr.scopes 
			-Array- 
			This is what the req.user.is() function reads against
	*/
	//Example - canSubmit now represents a true or false of whether the current user has the permission to submit orders

	// Remove Actions that are not allowed or the user doesn't have authorization to perform
	order.objActions = req.doc.possibleActions.filter((action) => {
		if (!allowedActions.includes(action.ActionName)) { // First - make sure this action is allowed
			return false
		}

		if (action.Scope === "NA") { // Second - No Authroization Required for this action
			return true
		}

		//	If this order was not created by this user, make sure this user can view other 
		if (order.createdBy !== req.user.id) {
			if (!req.user.is("REDFIG_W_WORDER_PROCESS_OTHERS")) {
				return false
			}
		}

		//	Finaly - make sure this user has the correct scope
		return req.user.is(action.Scope)
	})

	return order
};

//	ADD STATUS DESCRIPTION
const addStatusDescription = async order => {

	//TODO - Make this dynamic based on data-model type
	switch (order.OrderStatus) {
		case 1:
			order.OrderStatusDesc = "Draft"
			break;
		case 10:
			order.OrderStatusDesc = "Created"
			break;
		case 20:
			order.OrderStatusDesc = "Released"
			break
		case 30:
			order.OrderStatusDesc = "Partially Confirmed"
			break
		case 40:
			order.OrderStatusDesc = "Final Confirmed"
			break
		case 50:
			order.OrderStatusDesc = "Completed"
			break
		case 90:
			order.OrderStatusDesc = "Deleted"
			break
	}

	//	Set Operation Status Desc
	order.Operations = order.Operations.map((op) => {
		switch (op.OperationStatus) {
			case 10:
				op.OperationStatusDesc = "Created"
				break
			case 20:
				op.OperationStatusDesc = "Released"
				break
			case 30:
				op.OperationStatusDesc = "Part Confirmed"
				break
			case 40:
				op.OperationStatusDesc = "Final Confirmed"
				break
		}
		return op
	})

	//	Set Confirmation status
	order.Confirmations = order.Confirmations.map((conf) => {
		if (conf.Reversed) {
			conf.Status = 2
			conf.StatusDesc = "Cancelled"
		} else if (conf.FinalConfirmation) {
			conf.Status = 1
			conf.StatusDesc = "Final"
		} else {
			conf.Status = 0
			conf.StatusDesc = "Partial"
		}

		if (conf.hasOwnProperty("cancelledOrder_ID") && !conf.cancelledOrder_ID) {
			conf.cancelledOrder_ID = null
		}

		return conf
	})


}