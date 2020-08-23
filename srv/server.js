// /*eslint no-console: 0, no-unused-vars: 0, no-undef:0*/
"use strict";

const cds = require("@sap/cds");
const proxy = require("@sap/cds-odata-v2-adapter-proxy");
// const cdsmtx = require("@sap/cds-mtx");
cds.on('bootstrap', (app) => {
    app.use(proxy()) // allow for /v2/ Odata
    // cdsmtx().in(app)
});
module.exports = cds.server;