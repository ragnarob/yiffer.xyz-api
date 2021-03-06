export default class ModLogger {
  constructor (app, databaseFacade) {
    this.app = app
    this.databaseFacade = databaseFacade
  }

  async addModLog (reqOrUserId, actionType, ationDescription, actionDetails) {
    let userId
    if (typeof(reqOrUserId) === 'number') {
      userId = reqOrUserId
    }
    else {
      userId = reqOrUserId.session?.user?.id
    }
    if (!userId) {
      return
    }

    let query = 'INSERT INTO modlog (User, ActionType, ActionDescription, ActionDetails) VALUES (?, ?, ?, ?)'
    let queryParams = [userId, actionType, ationDescription, actionDetails]
    try {
      await this.databaseFacade.execute(query, queryParams)
    }
    catch (err) {
      console.log(`Error adding mod log: `, err)
    }
  }
}