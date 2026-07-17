import express from 'express'
import { createIntegration, listIntegrations } from './controllers/integrateController.js'

const router = express.Router()

router.post('/integrate', createIntegration)
router.get('/integrate', listIntegrations)

export default router