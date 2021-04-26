export class ApiError extends Error {
	constructor(message, status) {
		super(message)
		this.status = status
		this.name = 'ApiError'
	}
}

export default class BaseRouter {
	constructor (app, databaseFacade, modLogger) {
		this.app = app
		this.databaseFacade = databaseFacade
		this.modLogger = modLogger
	}

	returnApiError(res, error) {
		// TODO remove this once everything uses returnApiError. For now, to deal with
		// database-returned stuff, which must support the old ways
		if ('customErrorMessage' in error) {
			console.log(`[500] Controlled error: ${error.error}`)
			if ('error' in error) {
				console.error(error.error)
			}

			error = new ApiError(error.customErrorMessage, 500)
		}
		else if (!(error instanceof ApiError)) {
			console.error(`[500] UNCAUGHT error: ${error.stack}`)
			error = new ApiError('Server error', 500)
		}
		else {
			console.log(`[${error.status}] Controlled error: ${error.message}`)
		}

		try {
			if (res) {
				res.status(error.status).send(error.message)
			}
		}
		catch (err2) {
			console.error('REAL BAD: Error returning error', err2)
		}
	}

	// TODO SWAP ALL USAGES for returnStatusError
	returnError (errorMessage, res, err, fullErr) {
		console.log('Error: ', errorMessage)
		console.log(fullErr)
	
		try {
			if (res) { res.json({ error: errorMessage }) }
		}
		catch (err2) {
			console.log('Error returning error', err2)
		}
	}

	returnStatusError(status, res, error) {
		let errorToSend
		if (typeof(error) === 'string') {
			console.log(`Controlled error with status ${status}: ${error.customErrorMessage}`)
			errorToSend = error
		}
		else if ('customErrorMessage' in error) {
			console.log(`Controlled error with status ${status}: ${error.customErrorMessage}`)
			errorToSend = error.customErrorMessage
		}
		else {
			console.log(`FATAL error with status ${status}:`, error)
			errorToSend = 'Server error'
		}

		try {
			if (res) {
				res.status(status).send(errorToSend)
			}
		}
		catch (err2) {
			console.log('Error returning error', err2)
		}
	}

	getUser (req) {
		if (req.session && req.session.user) {
			return req.session.user
		}
		else {
			return null
		}
	}

	async getUserAccount (userId) {
    let query = 'SELECT Id AS id, Username AS username, Email AS email, UserType AS userType, CreatedTime AS createdTime FROM user WHERE id = ?'
    let queryParams = [userId]

    let results = await this.databaseFacade.execute(query, queryParams, 'Error getting user email')
    return results[0]
  }

	async authorizeUser (req, res, next) {
		let user = this.getUser(req)
		if (!user) {
			res.json({error: 'Not logged in'})
		}
		else {
			next()
		}
	}

	async authorizeMod (req, res, next) {
		let authorized = await this.authorize(req, res, 'moderator')
		if (authorized === true) {
			if (next) { next() }
			else { return authorized === true }
		}
	}

	async authorizeAdmin (req, res, next) {
		let authorized = await this.authorize(req, res, 'admin')
		if (authorized === true) {
			if (next) { next() }
			else { return authorized === true }
		}
	}

	async authorize(req, res, role) {
		try {
			if (!req.session || !req.session.user) {
				res.status(401).json({error: 'Not logged in'})
			}
			else {
				let query = 'SELECT * FROM user WHERE Username=?'
				let userData = await this.databaseFacade.execute(query, [req.session.user.username])
				if (role === 'moderator') {
					if (userData[0].UserType === 'moderator' || userData[0].UserType === 'admin') {
						return true
					}
					else {
						res.status(403).json({error: 'Unauthorized'})
					}
				}
				else if (role === 'admin') {
					if (userData[0].UserType === 'admin') {
						return true
					}
					else {
						res.status(403).json({error: 'Unauthorized'})
					}
				}
			}
		}
		catch (err) {
			res.json({error: 'Error authorizing user'})
			console.log(err)
		}
	}

	addModLog (req, actionType, ationDescription, actionDetails) {
		this.modLogger.addModLog(req, actionType, ationDescription, actionDetails)
	}
}