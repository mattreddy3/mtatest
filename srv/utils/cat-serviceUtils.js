const addTenantToWrite = tenantID => req => {
	
	//TODO - Need this to work for Deep Entities
	const {
		data
	} = req
	if (data) {
		data.tenantID = tenantID
	}
}

const addTenantToRead = tenantID => req => {
	// Need to inject tenant ID to query here - affects all READ calls
	// Test ids: 21bf2199-bfe3-4690-913f-5da194e4782e, 2fe400d9-4e30-4f47-b88e-a386a07f901d
	if (!req.query.SELECT.where) req.query.SELECT.where = []
	if (req.query.SELECT.where.length > 0) req.query.SELECT.where.push("and")

	req.query.SELECT.where.push({
			"ref": ["tenantID"]
		},
		"=", {
			"val": tenantID
		})
}

module.exports = {
	addTenantToRead,
	addTenantToWrite
}