angular.module('appRoutes', []).config(['$routeProvider', '$locationProvider', function ($routeProvider, $locationProvider) {
  $routeProvider
    .when('/', {
      templateUrl: '/views/comics.html',
      controller: 'ComicsController'
    })

    .when('/admin', {
      templateUrl: '/views/admin.html',
      controller: 'AdminController'
    })

    .when('/modIndex', {
      templateUrl: '/views/modIndex.html',
      controller: 'ModIndexController'
    })

    .when('/stats', {
      templateUrl: '/views/stats.html',
      controller: 'StatsController'
    })

    .when('/ragTest', {
      title: 'Home - Yiffing time',
      templateUrl: '/views/comicsTest.html',
      controller: 'TestComicsController'
    })

    .when('/donate', {
      templateUrl: '/views/donate.html'
    })

    .when('/survey', {
      templateUrl: '/views/survey.html',
      controller: 'SurveyController'
    })

    .when('/about', {
      templateUrl: '/views/about.html'
    })

    .when('/contact', {
      templateUrl: '/views/contact.html',
      controller: 'ContactController'
    })

    .when('/modPanel', {
      templateUrl: '/views/modPanel.html',
      controller: 'ModPanelController'
    })

    .when('/artist/:artistName', {
      templateUrl: '/views/artist.html',
      controller: 'ArtistController'
    })

    .when('/oldmNet', {
      templateUrl: '/views/comics_old.html',
      controller: 'ComicsOldController'
    })

    .when('/listRag', {
      templateUrl: '/views/comicsOldNew.html',
      controller: 'ComicsOldNewController'
    })

    .when('/:comicName', {
      templateUrl: '/views/comicsDetail.html',
      controller: 'ComicsDetailController'
    })

    .otherwise({
      redirectTo: '/'
    })

    $locationProvider.html5Mode({
      enabled: true,
      requireBase: false
    })
    $locationProvider.hashPrefix('!');

}])
