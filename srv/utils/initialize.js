/*eslint no-console: 0, no-unused-vars: 0*/
"use strict";
module.exports = {
	initExpress: function (testMode = false) {
		var xsenv = require("@sap/xsenv");
		var passport = require("passport");
		var xssec = require("@sap/xssec");
		var express = require("express");

		//logging
		var logging = require("@sap/logging");
		var appContext = logging.createAppContext();

		//Initialize Express App for XS UAA and HDBEXT Middleware
		var app = express();
		passport.use("JWT", new xssec.JWTStrategy(xsenv.getServices({
			uaa: {
				tag: "xsuaa"
			}
		}).uaa));
		app.use(logging.middleware({
			appContext: appContext,
			logNetwork: true
		}));
		app.use(passport.initialize());
		var hanaOptions = xsenv.getServices({
			hana: {
				tag: "hana"
			}
		});
		app.use(
			passport.authenticate("JWT", {
				session: false
			})
		);
		app.use(express.json())
		return app;
	}

};