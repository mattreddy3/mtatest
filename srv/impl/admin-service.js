"use-strict";

const cds = require("@sap/cds")

//	HardCode this for now
const tenantID = "21bf2199-bfe3-4690-913f-5da194e4782e"

// Load Test Functions
const {
	runTestCase,	
} = require("../functionsPlantMaint/TestCases")


//	Load Utility Functions
const {
	addTenantToRead,
	addTenantToWrite,
} = require("../utils/cat-serviceUtils.js")


// Register Events
module.exports = cds.service.impl(srv => {

	srv.before('READ', addTenantToRead(tenantID))
	srv.before('CREATE', addTenantToWrite(tenantID))
	srv.before('UPDATE', addTenantToWrite(tenantID))
	srv.before('DELETE', addTenantToWrite(tenantID))
	
	srv.on('run', 'TestCases', runTestCase )
	srv.on('UPDATE', 'TestCases', runTestCase )
								
})
