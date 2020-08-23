"use-strict";
const cds = require("@sap/cds")
const {cloneDeep} = require("lodash")
const checkAuthorization = async (role, errIfFalse) => {
	//TODO This function checks if the current user has a specific role
	//		returns true/false
	//	If the boolean parameter 'errIfFalse' is passed in, we throw an exception if user does not have role
	//		This should allow us to handle authorization errors in a standardized way (maybe log them?)
	
	return true
}

// const deepClone = input => cloneDeep([input])[0]
const deepClone = input => cloneDeep([input])[0]

const shallowClone = input => Object.assign({}, input)

const getUserRoles = async () => {
	
	var userRoles = []
	userRoles.push('NA')		//NA = Generic Roles for No Auth. Required
	
	return userRoles
}

const getTenantID = () => {
	return '21bf2199-bfe3-4690-913f-5da194e4782e'
}

const validateRequiredFields = requiredFields => async(req) => {
	// TODO: assign and grab labels
	// object map of fields: req.target.elements

	const missingFields = requiredFields.filter(function (fieldName) {
		if (!req.data[fieldName]) {
			return true
		} else {
			return false
		}
	}).map(function (fieldName) {
		return {
			"code": "400",
			"message": "Field " + fieldName + " is missing",
			"target": fieldName
		}
	})
	if (missingFields.length > 0) {
		req.error({
			code: 400,
			message: "There was an issue submitting your request",
			details: missingFields
		})
	}
}

const olavoValidateRequiredFields = (req, data, fields) => {
	
	// TODO: assign and grab labels
	// object map of fields: req.target.elements

	const missingFields = fields.filter(function (field) {
		let fieldName = field.key
		if (!data[fieldName]) {
			return true
		} else {
			return false
		}
	}).forEach( (field) => {
		req.error({
			code: 400,
			message: "Field " + field.desc + " is missing",
			target: field.key
		})
	})
	
	return req
}

	

const validateStartEndDates = (fieldName, fieldName2) => async(req) => {
	const date1 = req.data[fieldName]
	const date2 = req.data[fieldName2]
	if (date1 > date2) {
		req.error({
			code: 400,
			message: "There were issues with your date fields",
			details: [{
				"code": "400",
				"message": fieldName2 + " should be on or after " + fieldName,
				"target": fieldName2
			}]
		})
	}
}

const convertDateJsonToEpoch = (jsonDateTime) => {
	var epoch = new Date(jsonDateTime).getTime()
	return "\/Date(" + epoch + ")\/"
}

const convertDateEpochToJson = (epochDateTime) => {
	
	if( typeof epochDateTime == 'string' && epochDateTime.search('/Date') >= 0) {
		var dateValue = new Date(parseInt(epochDateTime.substr(6,13)))
		return dateValue.toJSON()
	} else {
		return epochDateTime
	}
}

//	GET ENTITY NAME FROM TARGET
const getEntityNameFromTarget = (target) => {
	
	//	Use this a lot thorughout the codebase, so made a funciton out of it
	//	in case SAP inevitably changes this in the future, it will be easier to fix
	if(typeof target === "object"){
		return target.name.split(".")[1]
	} else {
		return target.split(".")[1]
	}
	
}


module.exports = {
	deepClone,
	shallowClone,
	validateRequiredFields,
	olavoValidateRequiredFields,
	validateStartEndDates,
	checkAuthorization,
	getTenantID,
	getUserRoles,
	convertDateEpochToJson,
	convertDateJsonToEpoch,
	getEntityNameFromTarget
}