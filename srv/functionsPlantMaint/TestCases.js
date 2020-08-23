"use-strict";
// This file contains all custome developed Test Cases

//	IMPORTS
const cds = require("@sap/cds")

const runTestCase = async (req) => {
	
	// STEP 1 -	Create Notification
	// const notification = 
	// try{
	// 	notification = test01(req) 
		
	// } catch( err ){
		
	// }
	
	
	return req.reply(req.data)
}


// EXPORT - These are the "Public" functions we can export
module.exports = {
	runTestCase
};
