"use-strict";

//	This file Contains functions for error handling
//	TODO - Consider turning this into a Class, I think that's how this first function behaves anyways

function redfigError(code, message, target) {
	
	const error = {}
	error.code = code
	error.message = message
	error.target = target
	
	var errors = []
	errors.push(error)
	
	this.getMessages = function(){
		return errors
	}
	this.getCode = function(){
		return error.code
	}
	this.addMessage = function(code,message,target){
		const newError = {}
		newError.code = code
		newError.message = message
		newError.target = target
		errors.unshift(newError)
	}
	this.logErrors = function (){
		var lead = '>'
		errors.forEach( log => {
			lead = '--' + lead
			console.log( lead + log.message) 
		})
	}
	this.stringfy = function(){
		var message
		errors.forEach( error => {
			if(message){
				message = message + ' / ' + error.message
			}else {
				message = error.message
			}
		})
		return message
	}
}

const errorHandleAddThrow = function(err,code,message,target) {
	throw errorHandleAdd(err, code, message, target);
}


const errorHandleAdd = function(err,code,message,target) {
	
	if(!(err instanceof redfigError)){
		err = new redfigError( 500, err.message)
	}
	err.addMessage(code, message, target)
	return err
}


module.exports = {
	redfigError,
	errorHandleAddThrow,
	errorHandleAdd
}