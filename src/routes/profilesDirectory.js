const express = require('express');
const { getCount, getSample } = require('./controllers/profilesDirectoryController');

const router = express.Router();

// Public on purpose — this powers a public word-cloud page.
// Add `authenticate` here (like the profile.js router does) if you
// decide this should require login instead.
router.get('/count',  getCount);
router.get('/sample', getSample);

module.exports = router;const express = require('express');
const { getCount, getSample } = require('./controllers/profilesDirectoryController');

const router = express.Router();

// Public on purpose — this powers a public word-cloud page.
// Add `authenticate` here (like the profile.js router does) if you
// decide this should require login instead.
router.get('/count',  getCount);
router.get('/sample', getSample);

module.exports = router;