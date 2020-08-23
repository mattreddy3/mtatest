"use-strict";

const cds = require("@sap/cds")

//	HardCode this for now
const tenantID = "21bf2199-bfe3-4690-913f-5da194e4782e"

// Load Notification Functions
const {
	readData,	//Run expanded service to GET Notifications (using req as input)
	preProcess, 		//Pre-processing steps
	process,			//Process Status Changes to Notification
	postProcess,		//Post Processing Steps, including ERP update
	readActions 		// Stubbing out of Notifications()/objActions call
// } = require("../functions/NotificationFunctions")
} = require("../functions/MainHandler")

const {
	bootstrapReq
 } = require("../functionsPlantMaint/Orders")

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
	
	srv.before(	["READ", "CREATE", "UPDATE", "process"], "Orders", bootstrapReq)
	srv.before(	["READ", "CREATE", "UPDATE"], "OrderMovements", bootstrapReq)
	srv.before(	["READ", "CREATE", "UPDATE"], "OrderConfirmations", bootstrapReq)
	srv.before(	["READ", "CREATE", "UPDATE"], "OrderComponents", bootstrapReq)
	srv.before(	"READ", "ObjActions", bootstrapReq)

	srv.on("READ", "Orders", readData)							// Replaces standard Handler for GET
	srv.on("READ", "ObjActions", readActions)									// Actions must be filled manually
		
	srv.on(		["CREATE", "UPDATE", "process"], "Orders", preProcess)	// Validate Inputs, get current DB state
	srv.on(		["UPDATE", "CREATE", "process"], "Orders", process) 		// apply business rules, check ERP, process actions
	srv.after(	["CREATE", "UPDATE", "process"], "Orders", postProcess)	// trigger synch jobs
	
	srv.on(		"CREATE", "OrderMovements", preProcess)		// Validate Inputs, get current DB state
	srv.on(		"CREATE", "OrderMovements", process) 		// apply business rules, check ERP, process actions
	srv.after(	"CREATE", "OrderMovements", postProcess)	// trigger synch jobs
	
	srv.on(		"CREATE", "OrderConfirmations", preProcess)		// Validate Inputs, get current DB state
	srv.on(		"CREATE", "OrderConfirmations", process) 		// apply business rules, check ERP, process actions
	srv.after(	"CREATE", "OrderConfirmations", postProcess)	// trigger synch jobs
	
	srv.on(		["CREATE", "UPDATE", "DELETE"], "OrderComponents", preProcess)		// Validate Inputs, get current DB state
	srv.on(		["CREATE", "UPDATE", "DELETE"], "OrderComponents", process) 		// apply business rules, check ERP, process actions
	srv.after(	["CREATE", "UPDATE", "DELETE"], "OrderComponents", postProcess)	// trigger synch jobs

})