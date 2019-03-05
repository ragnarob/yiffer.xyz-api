let FileSystemFacade = require('../fileSystemFacade')
let BaseRouter = require('./baseRouter')

module.exports = class MiscRouter extends BaseRouter {
	constructor (app, databaseFacade, mysqlPool) {
		super()
		this.app = app
		this.databaseFacade = databaseFacade
		this.setupRoutes()
		this.mysqlPool = mysqlPool
	}

	setupRoutes () {
		this.app.get ('/api/comicsuggestions', (req, res) => this.getComicSuggestions(req, res))
		this.app.post('/api/comicsuggestions', (req, res) => this.addComicSuggestion(req, res))
		this.app.post('/api/comicsuggestions/process', (req, res) => this.processComicSuggestion(req, res))
	
		this.app.get ('/api/comicpagechanges', (req, res) => this.getComicPageChanges(req, res))
		this.app.post('/api/swapcomicpages', (req, res) => this.swapComicPages(req, res))
	}

	async getComicSuggestions (req, res) {
		let query = 'SELECT Id AS id, Name AS name, ArtistName AS artist, Description AS description, User AS user FROM ComicSuggestion WHERE Processed=0 ORDER BY Timestamp DESC'
		try {
			let result = await this.databaseFacade.execute(query, null, 'Database query error')
			res.json(result)
		}
		catch(err) {
			return this.returnError(err.message, res, err.error)
		}
	}

	async addComicSuggestion (req, res) {
		let query = 'INSERT INTO ComicSuggestion (Name, ArtistName, Description, User) VALUES (?, ?, ?, ?)'
		let user = 'todo ragnar todo'
		let queryParams = [req.body.comicName, req.body.artist, req.body.comment, user]
		try {
			await this.databaseFacade.execute(query, queryParams, 'Database error')
			res.json({success: true})
		}
		catch (err) {
			return this.returnError(err.message, res, err.error)
		}
	}

	async processComicSuggestion (req, res) {
		let query = 'UPDATE ComicSuggestion SET Processed=1, Approved=? WHERE Id=?'
		let queryParams = [req.body.isApproved, req.body.suggestionId]
		try {
			await this.databaseFacade.execute(query, queryParams, 'Database error')
			res.json({success: true})
		}
		catch (err) {
			return this.returnError(err.message, res, err.error)
		}
	}

	async getComicPageChanges (req, res) {
		let query = 'SELECT MAX(Timestamp) AS lastUpdated FROM ComicPageChanges WHERE ComicId = ?'
		let queryParams = [req.query.id]
		try {
			let result = await this.databaseFacade.execute(query, queryParams, 'Database error')
			if (results.length===0) { res.json({lastUpdated: null}) }
			else { res.json(results[0]) }
			res.json(result)
		}
		catch (err) {
			return this.returnError(err.message, res, err.error)
		}
	}

	async swapComicPages (req, res) {
		let [comicName, comicId, pageNumber1, pageNumber2] = 
			[req.body.comicName, req.body.comicId, req.body.pageNumber1, req.body.pageNumber2]
		let comicFolderPath = __dirname + '/../../../client/public/comics/' + comicName
		let pageName1 = this.getPageName(pageNumber1)
		let pageName2 = this.getPageName(pageNumber2)
		
		let query = 'INSERT INTO ComicPageChanges (ComicId) VALUES (?)'
		let queryParams = [comicId]

		try {
			await FileSystemFacade.renameFile(`${comicFolderPath}/${pageName1}.jpg`, 
				`${comicFolderPath}/temp.jpg`, 'Error renaming first file')
			await FileSystemFacade.renameFile(`${comicFolderPath}/${pageName2}.jpg`,
				`${comicFolderPath}/${pageName1}.jpg`, 'Error renaming second file')
			await FileSystemFacade.renameFile(`${comicFolderPath}/temp.jpg`,
				`${comicFolderPath}/${pageName2}.jpg`, 'Error renaming first file')
			
			await this.databaseFacade.execute(query, queryParams,
				'Database error: Error updating comic page change timestamp')
			res.json({success: true})
		}
		catch (err) {
			return this.returnError(err.message, res, err.error)
		}
	}

	getPageName (pageNumber) {
		return pageNumber<10 ? '0'+pageNumber : pageNumber
	}
}
