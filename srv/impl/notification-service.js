"use-strict";

const cds = require("@sap/cds")

//	HardCode this for now
const tenantID = "21bf2199-bfe3-4690-913f-5da194e4782e"

// Load Notification Functions
const {
	readData, //Run expanded service to GET Notifications (using req as input)
	preProcess, //Pre-processing steps
	process, //Process Status Changes to Notification
	postProcess, //Post Processing Steps, including ERP update
	readActions // Stubbing out of Notifications()/objActions call
	// } = require("../functions/NotificationFunctions")
} = require("../functions/MainHandler")

const {
	bootstrapReq
} = require("../functionsPlantMaint/Notifications")

//	Load Utility Functions
const {
	addTenantToRead,
	addTenantToWrite,
} = require("../utils/cat-serviceUtils.js")

// Register Events
module.exports = cds.service.impl(srv => {

	srv.before("READ", addTenantToRead(tenantID))
	srv.before("CREATE", addTenantToWrite(tenantID))
	srv.before("UPDATE", addTenantToWrite(tenantID))
	srv.before("DELETE", addTenantToWrite(tenantID))

	// srv.before(	["READ","CREATE", "UPDATE", "process"], "Notifications", bootstrapReq)
	srv.before("READ", "ObjActions", bootstrapReq)
	srv.before("READ", bootstrapReq)
	srv.on("READ", "Notifications", readData) // Replaces standard Handler for GET
	srv.on("READ", "ObjActions", readActions) // Actions must be filled manually

	srv.on(["CREATE", "UPDATE", "process"], "Notifications", preProcess) // Validate Inputs, get current DB state
	srv.on(["UPDATE", "CREATE", "process"], "Notifications", process) // apply business rules, check ERP, process actions
	srv.after(["CREATE", "UPDATE", "process"], "Notifications", postProcess) // trigger synch jobs

})