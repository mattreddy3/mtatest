var axios = require("axios")
axios.defaults.xsrfHeaderName = "x-csrf-token"
const xml2js = require('xml2js');
// const extend = require("util")._extend;
var xsenv = require("@sap/xsenv");
const {
	redfigError,
	errorHandleAddThrow,
	errorHandleAdd
} = require("../utils/redfigError")
const {
	convertDateEpochToJson,
	convertDateJsonToEpoch
} = require("../utils/hookUtils")
const formUrlEncoded = x =>
	Object.keys(x).reduce((p, c) => p + `&${c}=${encodeURIComponent(x[c])}`, "")

// This env var is for changing the service endpoint
var erpEnv = "QA"
const getServiceUri = myEnv => {
	let env1 = myEnv ? myEnv : erpEnv
	switch (env1) {
		case "DEV":
			return "/sap/opu/odata/sap/ZREDFIG_WERKS_DEV_SRV/"
			// default cases
			// case "PD":
			// case "QA":
		default:
			return "/sap/opu/odata/sap/ZREDFIG_WERKS_SRV/"
	}
}
//----------------------------------------------------------------------------------------------------------------
//	"PUBLIC" FUNCTIONS - Functions that are available outside of this file
//----------------------------------------------------------------------------------------------------------------
const setEnv = env => {
	erpEnv = env
	return erpEnv
}
const getDataFromERP = async (entityName, lastSynch, expands, ERPID) => {

	const clauses = getURLClauses(lastSynch, expands, ERPID)
	var results = await getData(entityName, clauses);

	//format response payload
	return results.map(result => formatERPResponse(result))
}

//	POST DATA TO ERP
const postDataToERP = async (entityName, data, simulate) => {

	//	STEP 1 - Get Metadata for the entire Service
	const metadata = await getMetadataService()

	//	STEP 2 - Use this to filter the data
	const sendPayload = await moveCorresponding(data, metadata, entityName)

	//	STEP 3 - Additional fields for Back-End ERP
	sendPayload.Simulate = simulate
	// if(sendPayload.ERPID){
	// 	sendPayload.ERPFunction = "U"
	// } else {
	// 	sendPayload.ERPFunction = "I"
	// }

	//	STEP 4 - Make the call to ERP
	const response = await postData(entityName, sendPayload)
	return formatERPResponse(response, simulate)
}

module.exports = {
	getDataFromERP,
	postDataToERP,
	setEnv
}

//----------------------------------------------------------------------------------------------------------------
//	"PRIVATE" FUNCTIONS - functions that can only be called from within the file
//----------------------------------------------------------------------------------------------------------------

function getTokenData(service) {
	return {
		"client_id": service.clientid,
		"client_secret": service.clientsecret,
		"grant_type": "client_credentials"
	}
}
const services = xsenv.getServices({
	"destination": {
		"tag": "destination"
	},
	"xsuaa": {
		"tag": "xsuaa"
	},
	"connectivity": {
		"tag": "connectivity"
	}
})
const destService = services.destination;
const uaaService = services.xsuaa;
const connService = services.connectivity;
async function getToken(name) {
	// "connectivity" or "destination"
	// requires services to be extracted from xsenv as "services"
	const tokenData = getTokenData(services[name]);
	const tokenRes = await axios({
		url: uaaService.url + "/oauth/token",
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded"
		},
		data: formUrlEncoded(tokenData)
	})
	return tokenRes.data.access_token
}
var destToken, connToken, csrfHeaders;

const getDestination = async function (sDestinationName) {
	// removing destToken cache to avoid 403 issues
	//TODO: add logic to take into account expiring parameter from token get
	// if (!destToken) {
	destToken = await getToken("destination")
	// }
	const res = await axios({
		url: destService.uri + "/destination-configuration/v1/destinations/" + sDestinationName,
		headers: {
			"Authorization": "Bearer " + destToken
		}
	})
	return res.data
};
const getCookiesAndCSRF = async (ops) => {
	const newHeaders = Object.assign({}, ops.headers, {
		"x-csrf-token": "fetch"
	});
	const res = await axios(Object.assign({}, ops, {
		method: "GET",
		headers: newHeaders
	}));
	const cookies = res.headers["set-cookie"]
	if (cookies) {
		// clear cookies - we are having an issue with multiple auth cookies being passed
		axios.defaults.headers.Cookie = "";
		cookies.forEach(function (cookie) {
			let newString = cookie + ";"
			if (!axios.defaults.headers.Cookie) {
				axios.defaults.headers.Cookie = ""
			}
			axios.defaults.headers.Cookie = axios.defaults.headers.Cookie + newString
		})
	}
	return {
		"x-csrf-token": res.headers["x-csrf-token"]
	}
}
// If env = QA => /sap/opu/odata/sap/ZREDFIG_WERKS_SRV/
// if env = DEV => /sap/opu/odata/sap/ZREDFIG_WERKS_DEV_SRV/

const determineConnectionOptions = async (method, sEndpoint, clauses, data) => {

	// /*************************************************************
	//  *** Get destination from the destination service ***
	//  *************************************************************/
	const sDestinationName = "mfp_gwd_dev";
	//TODO: @Olavo: ias destination = "sap_ias_dev"

	// removing connToken cache to avoid 403 issues
	//TODO: add logic to take into account expiring parameter from token get
	// if (!connToken) {
	connToken = await getToken("connectivity")
	// }
	const destination = await getDestination(sDestinationName)
	// 	/*********************************************************
	// 	 ********* Access the destination securely *******
	// 	 *********************************************************/
	const token = destination.authTokens[0];
	// If env = QA => /sap/opu/odata/sap/ZREDFIG_WERKS_SRV/
	// if env = DEV => /sap/opu/odata/sap/ZREDFIG_WERKS_DEV_SRV/
	const serviceUri = getServiceUri()
	const returnOptions = {
		proxy: {
			host: connService.onpremise_proxy_host,
			port: connService.onpremise_proxy_port
		},
		data,
		method,
		url: destination.destinationConfiguration.URL + serviceUri + sEndpoint + clauses,
		headers: {
			"Authorization": `${token.type} ${token.value}`,
			"Proxy-Authorization": "Bearer " + connToken
		}
	};
	// turning off check for csrfHeader cache
	//TODO: add logic to take into account expiring parameter from headers get, specifically for set-cookie
	// if (!csrfHeaders && method === "POST") {
	if (method === "POST" || method === "PUT") {
		csrfHeaders = await getCookiesAndCSRF(returnOptions);
	}
	returnOptions.headers = Object.assign({}, returnOptions.headers, csrfHeaders)
	return returnOptions
}

const postData = async (sEndpoint, data) => {

	//TODO: try this in a do-while loop
	let stopped = false
	let count = 1
	let err = null
	let res = null
	while (!stopped) {
		try {
			err = null
			const ops = await determineConnectionOptions("POST", sEndpoint, "", data)
			res = await axios(ops);
		} catch (e) {
			err = e
		} finally {
			count++
			if (res || count > 3 || err.response.status !== 403) {
				stopped = true
			}
		}
	}
	if (err) {
		logERPPayload(sEndpoint, data)
		handleERPError(err)
	} else {
		return res.data.d;
	}
}

const logERPPayload = (sEndpoint, data) => {

	const json = JSON.stringify(data)

	console.log("")
	console.log(sEndpoint)
	console.log("")
	console.log(json)

}

const getData = async (sEndpoint, clauses) => {

	const ops = await determineConnectionOptions("GET", sEndpoint, clauses)
	try {
		const res = await axios(ops);
		return res.data.d.results;
	} catch (e) {
		handleERPError(e)
	}
}
//	HANDLE ERP ERROR
const handleERPError = (e) => {

	var errorObj = new redfigError(e.response.status, e.message)

	if (e.response.data.error) {
		var error = e.response.data.error
		if (error.innererror.errordetails) {
			error.innererror.errordetails.forEach(errordetail => {
				errorHandleAdd(errorObj, e.response.status, errordetail.message)
			})
		}
		if (error.message) {
			errorHandleAdd(errorObj, e.response.status, error.message.value)
		}
	}

	throw errorObj
}

const getMetadataService = async (entity) => {

	var sEndpoint = "$metadata"
	const ops = await determineConnectionOptions("GET", sEndpoint, "")
	const res = await axios(ops);
	return await xml2js.parseStringPromise(res.data)
}

const getMetadataEntity = async (metadata, entity) => {

	/* eslint-disable dot-notation */
	const schema = metadata["edmx:Edmx"]["edmx:DataServices"][0]["Schema"]
	const entitySets = schema[0]["EntityContainer"][0]["EntitySet"]
	const myEntitySet = entitySets.filter(function (entitySet) {
		return entitySet["$"]["Name"] === entity
	})[0]
	const entityTypeName = myEntitySet["$"]["EntityType"].split(".")[1]

	const entityTypes = schema[0]["EntityType"]
	const myEntity = entityTypes.filter(function (entityType) {
		return entityType["$"]["Name"] === entityTypeName
	})[0]

	//Get Associations
	const associationSets = schema[0]["EntityContainer"][0].AssociationSet
	if (myEntity.NavigationProperty) {
		myEntity.NavigationProperty = myEntity.NavigationProperty.map((navProp) => {
			const associationSet = associationSets.filter(assSet => assSet["$"].Association === navProp["$"].Relationship)[0]
			navProp.childEntity = associationSet.End.filter(line => line["$"].Role === navProp["$"].ToRole)[0]["$"].EntitySet
			return navProp
		})
	}

	/* eslint-enable dot-notation */
	return myEntity
}

const getPropsFromMetadata = async (metadataSrv, entity) => {

	//	Get Entity Specific metadata
	const metadata = await getMetadataEntity(metadataSrv, entity)

	/* eslint-disable dot-notation */
	var navProps = metadata["NavigationProperty"]
	if (!navProps) {
		navProps = []
	}
	const props = metadata["Property"]
	if (!props) {
		props = []
	}

	const allProps = [...navProps, ...props].map((prop) => {
		const propRet = {}
		propRet.name = prop["$"]["Name"]
		propRet.type = prop["$"]["Type"]
		if (!propRet.type) {
			propRet.type = "Navigation"
			propRet.childEntity = prop.childEntity
		}
		return propRet
	})
	/* eslint-enable dot-notation */
	return allProps
}

const moveCorresponding = async (dataIn, metadataSrv, entityName) => {
	/*	
	 *		Import:	
	 *			dataIn 		-	Data structure
	 *			metadataSrv	-	This contains the entire Metadata document for the entire ERP service
	 *			entityName	-	Name of the current entity (ex:Notifications) being mapped
	 *
	 *		Return:	
	 *			dataOut		-	Data structure in the format of the ERP fields
	 *
	 *		Description:	This function converts a data object (ex:Notification) from the HANA data model format
	 *						and maps it into the format of the ERP OData service.
	 *						- Properties that exist in HANA, but do not exist in ERP, are note included in dataOut
	 *						This function also handles recursions, so if 
	 *
	 */


	var dataOut = {} //	Data Object that contains only the fields from ERP

	//Get the metatadata and list of properties specific to this entity
	var propList
	try {
		propList = await getPropsFromMetadata(metadataSrv, entityName)
	} catch (err) {
		redfigError = errorHandleAddThrow(err, 500, 'Error mapping ERP metafata for ' + entityName)
	}

	//	This propValueSet array will contain a list of property/value pairs
	//	The value could be another array in the case of a Composition (ex: Notificaiton/Items)
	const propValueSet = await Promise.all(propList.map(async (prop) => {
		var propValuePair = {}
		propValuePair.propName = prop.name

		if (prop.type === "Navigation") {
			if (dataIn[prop.name]) {
				propValuePair.value = await Promise.all(dataIn[prop.name].map((lineIn) => {
					return moveCorresponding(lineIn, metadataSrv, prop.childEntity) //RECURSION
				}))
			} else {
				propValuePair.value = [] // Add blank array to trigger Deep Expand
			}

		} else if (dataIn[prop.name] !== undefined) {
			propValuePair.value = dataIn[prop.name]

			if (prop.type === "Edm.DateTime") {
				if (propValuePair.value) {
					propValuePair.value = convertDateJsonToEpoch(propValuePair.value)
				} else {
					delete dataOut[prop.name] //Don't thing we need this
				}
			} else if (prop.type === "Edm.String" && typeof propValuePair.value !== "string") {
				if (propValuePair.value) {
					propValuePair.value = JSON.stringify(propValuePair.value)
				} else {
					propValuePair.value = ""
				}
			} else if (prop.type === "Edm.Boolean") {
				if (propValuePair.value !== false && propValuePair.value !== true) {
					delete propValuePair.value
				}
			}
		}

		return propValuePair
	}))

	//	Now take all of the propValue pairs and merge them into dataOut
	dataOut = propValueSet.reduce((dataOut, propValuePair) => {
		if (propValuePair.value !== undefined) {
			dataOut[propValuePair.propName] = propValuePair.value
		}
		return dataOut
	}, {})

	return dataOut
}

const getURLClauses = (lastSynch, expands, ERPID) => {

	//	Expand Clauses
	var expandClause
	if (expands && expands.length > 0) {
		expandClause = expands.reduce((expandClauseIn, expandItem, index) => {
			if (index === 0) {
				return expandClauseIn + expandItem
			} else {
				return expandClauseIn + "," + expandItem
			}
		}, "expand=")
	}

	//	Last Synch Filter
	//	For some reason, the ERPID filter can have a $ at the front, but the LastSynch cannot
	var filterClause
	if (ERPID) {
		filterClause = "$filter=ERPID eq '" + ERPID + "'"
	} else if (lastSynch) {
		filterClause = "filter=LastSynch ge \"" + convertDateJsonToEpoch(lastSynch) + "\""
	}

	// Concatenate Clauses
	if (filterClause && expandClause) {
		return "?$" + expandClause + "&" + filterClause
	} else if (filterClause) {
		return "?$" + filterClause
	} else if (expandClause) {
		return "?$" + expandClause
	} else {
		return " "
	}

}

const convertResultsToArray = (expandedEntity) => {
	//Convert expaded object directly into an array
	//	Ex: Notification.Items.Result[] ---> Notification.Items[]

	for (const property in expandedEntity) {
		var value = expandedEntity[property]
		if (value && typeof value == "object" && value.results) {
			expandedEntity[property] = value.results
		}
	}
}

//	FORMAT FIELDS
const formatFields = (entry, simulate) => {

	for (const property in entry) {
		//Apply formating based on data type
		if (Array.isArray(entry[property]) === true) {
			entry[property] = entry[property].map(line => formatFields(line, simulate))

		} else if (typeof entry[property] == "string" && entry[property].search("/Date") >= 0) {
			entry[property] = convertDateEpochToJson(entry[property])
		}
	}

	return entry
}

const formatERPResponse = (response, simulate) => {

	//Format Expanded Arrays
	convertResultsToArray(response)

	//Format Fields
	formatFields(response, simulate)

	return response
}