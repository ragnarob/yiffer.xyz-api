let BaseRouter = require('./baseRouter')

module.exports = class KeywordsRouter extends BaseRouter {
	constructor (app, databaseFacade, modLogger) {
		super(app, databaseFacade, modLogger)
		this.setupRoutes()
  }
  
  setupRoutes () {
    this.app.get ('/api/keywords', (req, res) => this.getAllKeywords(req, res))
    this.app.post('/api/keywords/removefromcomic', (req, res) => this.removeKeywordsFromComic(req, res))
    this.app.post('/api/keywords/addtocomic', (req, res) => this.addKeywordsToComic(req, res))
    this.app.post('/api/keywords', (req, res) => this.createKeyword(req, res))
    this.app.post('/api/keywordsuggestions/process', (req, res) => this.processKeywordSuggestion(req, res))
    this.app.post('/api/keywordsuggestions', (req, res) => this.addKeywordSuggestion(req, res))
    this.app.get ('/api/keywordsuggestions', (req, res) => this.getKeywordSuggestions(req, res))
    this.app.post('/api/keywords/log', (req, res) => this.logKeywordSearch(req, res))
  }

  async getAllKeywords (req, res) {
    let query = 'SELECT Keyword.KeywordName AS keyword, COUNT(*) AS count FROM ComicKeyword INNER JOIN Keyword ON (Keyword.Id = ComicKeyword.KeywordId) GROUP BY Keyword.Id ORDER BY count DESC'
    try {
      let result = await this.databaseFacade.execute(query)
      res.json(result)
    }
    catch (err) {
      return this.returnError(err.message, res, err.error)
    }
  }

	async removeKeywordsFromComic (req, res) {
		let [comicId, keywords] = [req.body.comicId, req.body.keywords]
    if (keywords.hasOwnProperty('name')) { keywords = [keywords] }

		let deleteQuery = 'DELETE FROM ComicKeyword WHERE (ComicId, KeywordId) IN ('
		let queryParams = []
		for (let keyword of keywords) {
			deleteQuery += '(?, ?), '
			queryParams.push(comicId, keyword.id)
		}
		deleteQuery = deleteQuery.substring(0, deleteQuery.length-2) + ')'

    try {
      await this.databaseFacade.execute(deleteQuery, queryParams)
      res.json({success: true})
			let comicName = (await this.databaseFacade.execute('SELECT Name FROM Comic WHERE Id=?', [comicId]))[0].Name
			this.addModLog(req, 'Keyword', `Remove ${keywords.length} from ${comicName}`, keywords.map(kw => kw.name).join(', '))
    }
    catch (err) {
			return this.returnError(err.message, res, err.error)
    }
	}

  async addKeywordsToComic (req, res) {
    let [comicId, keywords] = [req.body.comicId, req.body.keywords]
    if (keywords.hasOwnProperty('name')) { keywords = [keywords] }

    let insertQuery = 'INSERT INTO ComicKeyword (ComicId, Keyword) VALUES '
    let queryParams = []
    for (var keyword of keywords) {
			insertQuery += '(?, ?), '
			queryParams.push(comicId, keyword.id)
    }
		insertQuery = insertQuery.substring(0, insertQuery.length-2)

    try {
      await this.databaseFacade.execute(insertQuery, queryParams)
      res.json({success: true})
			let comicName = (await this.databaseFacade.execute('SELECT Name FROM Comic WHERE Id=?', [comicId]))[0].Name
			this.addModLog(req, 'Keyword', `Add ${keywords.length} to ${comicName}`, keywords.map(kw => kw.name).join(', '))
    }
    catch (err) {
			return this.returnError(err.message, res, err.error)
    }
  }

  async createKeyword (req, res) {
    let query = 'INSERT INTO Keyword (KeywordName) VALUES (?)'
    let queryParams = [req.body.keyword]
    try {
      await this.databaseFacade.execute(query, queryParams)
      res.json({success: true})
			this.addModLog(req, 'Keyword', `Add ${req.body.keyword}`)
    }
    catch (err) {
      return this.returnError(err.message, res, err.error)
    }
  }

  async addKeywordSuggestion (req, res) {
    let [comicId, suggestedKeyword, isAddingKeyword] = [req.body.comicId, req.body.keyword, req.body.extension ? 1 : 0]
    let user = this.getUser(req)
    if (user) { user = user.username }
    else { user = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || (req.connection.socket ? req.connection.socket.remoteAddress : null) }

    let query = 'INSERT INTO KeywordSuggestion (ComicId, KeywordId, Extension, User) VALUES (?, ?, ?, ?)'
    let queryParams = [comicId, suggestedKeyword.id, isAddingKeyword ? 1:0, user]
    try {
      await this.databaseFacade.execute(query, queryParams)
      res.json({success: true})
    }
    catch (err) {
      return this.returnError(err.message, res, err.error)
    }
  }

  async processKeywordSuggestion (req, res) {
		let [suggestionId, comicId, keyword, extension, isApproved] = 
			[req.body.suggestion.id, req.body.suggestion.comicId, req.body.suggestion.keyword, req.body.suggestion.addKeyword, req.body.isApproved]
    let updateQuery = 'UPDATE KeywordSuggestion SET Approved = ?, Processed = 1 WHERE Id = ?'
    let updateQueryParams = [isApproved ? 1 : 0, suggestionId]
    let insertQuery = extension ? 'INSERT INTO ComicKeyword (ComicId, KeywordId) VALUES (?, ?)' : 'DELETE FROM ComicKeyword WHERE ComicId = ? AND KeywordId = ?'
    let insertQueryParams = [comicId, keyword.id]
    try {
      if (isApproved) {
        await this.databaseFacade.execute(insertQuery, insertQueryParams, 'Database error: Error adding/deleting tags to/from comic')
      }
      await this.databaseFacade.execute(updateQuery, updateQueryParams, 'Database error: Error updating suggested tags')
      res.json({success: true})
			let comicName = (await this.databaseFacade.execute('SELECT Name FROM Comic WHERE Id=?', [comicId]))[0].Name
			this.addModLog(req, 'Keyword', `${isApproved ? 'Approve' : 'Reject'} ${keyword.name} for ${comicName}`)
    }
    catch (err) {
      if (err.error.sqlMessage && err.error.sqlMessage.includes('Duplicate')) {
        return this.returnError('Error adding tag: tag already exists on comic. Just reject this one please.', res)
      }
      return this.returnError(err.message, res, err.error)
    }
  }

  async getKeywordSuggestions (req, res) {
    let query = 'SELECT KeywordSuggestion.Id AS id, Comic.Name AS comicName, ComicId AS comicId, Extension AS addKeyword, User AS user, Keyword AS keyword FROM KeywordSuggestion INNER JOIN Comic ON (Comic.Id=KeywordSuggestion.ComicId) WHERE Processed = 0SELECT KeywordSuggestion.Id AS id, Comic.Name AS comicName, ComicId AS comicId, IsAdding AS addKeyword, User AS user, Keyword.KeywordName AS keyword FROM KeywordSuggestion INNER JOIN Comic ON (Comic.Id=KeywordSuggestion.ComicId) INNER JOIN Keyword ON (Keyword.Id = KeywordSuggestion.KeywordId) WHERE Processed = 0'
    try {
      let result = await this.databaseFacade.execute(query)
      res.json(result)
    }
    catch (err) {
      return this.returnError(err.message, res, err.error)
    }
  }

  async logKeywordSearch (req, res) {
    let keyword = req.body.keyword
    if (!keyword) { return }
    let query = 'UPDATE KeywordSearches SET Count = Count + 1 WHERE Keyword = ?'
    let queryParams = [keyword]
    try {
      await this.databaseFacade.execute(query, queryParams)
      res.json({success: true})
    }
    catch (err) {
      return this.returnError(err.message, res, err.error)
    }
  }
}
