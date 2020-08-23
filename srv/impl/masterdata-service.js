"use-strict";

const cds = require("@sap/cds")

//	HardCode this for now
const tenantID = "21bf2199-bfe3-4690-913f-5da194e4782e"

// Load Master Data Functions
const {
} = require("../functions/MasterDataFunctions")

//	Load Utility Functions
const {
	addTenantToRead,
} = require("../utils/cat-serviceUtils.js")

// Register Events
module.exports = cds.service.impl(srv => {

	srv.before('READ', addTenantToRead(tenantID));
	
});