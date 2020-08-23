"use-strict";

const cds = require("@sap/cds")

//	HardCode this for now
const tenantID = "21bf2199-bfe3-4690-913f-5da194e4782e"

// Load DataSynch Functions
const {
	dataSynchMaster,		//Master Data Synch Function
	clearLog,
	create
} = require("../functions/DataSynchFunctions")
const {
	setEnv
} = require("../functions/ERPFunctions")

const {
	readData,	//Run expanded service to GET Object (using req as input)
} = require("../functions/MainHandler")

//	Load Utility Functions
const {
	addTenantToRead,
	addTenantToWrite,
} = require("../utils/cat-serviceUtils.js")

const devUsers = [
	"reddy1023@gmail.com"
	]
// Register Events
module.exports = cds.service.impl(srv => {

	// srv.before(['READ','CREATE','UPDATE','DELETE'], req => {
	// 	if(devUsers.includes(req.user.id)){
	// 		setEnv("DEV")
	// 	}
	// })	
	srv.before('READ', addTenantToRead(tenantID))
	srv.before('CREATE', addTenantToWrite(tenantID))
	srv.before('UPDATE', addTenantToWrite(tenantID))
	srv.before('DELETE', addTenantToWrite(tenantID))
	//Actions
	srv.on('runAll', 'DataSynchJob', dataSynchMaster )
	srv.on('clearLog', 'DataSynchJob', clearLog )	
	srv.on('runSingle', 'DataSynchObjects', dataSynchMaster )

	// srv.on("READ", "Orders", readData)							// Replaces standard Handler for GET
								
})
