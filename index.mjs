import { Extension, Parameter } from 'talkops'
import pkg from './package.json' with { type: 'json' }

const baseUrl = new Parameter('BASE_URL')
  .setDescription('The base URL of your OpenHAB server.')
  .setPossibleValues(['http://openhab:8080', 'https://openhab.mydomain.net'])

const apiToken = new Parameter('API_TOKEN').setDescription('The copied API token.')

const extension = new Extension()
  .setName('OpenHAB')
  .setWebsite('https://www.openhab.org/')
  .setCategory('Home Automation')
  .setIcon(
    'https://play-lh.googleusercontent.com/PDnEr2ShVCnxVNK6-wlY3q1nGL39NM2-DMjfEZnAn_DcdsuKFULLjGcSkn_Wh_BXQj8',
  )
  .setVersion(pkg.version)
  .setDockerRepository('bierdok/talkops-openhab')
  .setFeatures([
    'Lights: Check status, turn on/off',
    'Shutters: Check status, open, close and stop',
  ])
  .setinstallationSteps([
    '[Generate an API token](https://www.openhab.org/docs/configuration/apitokens.html#generate-an-api-token)',
  ])
  .setParameters([baseUrl, apiToken])

const baseInstructions = `
You are a home automation assistant, focused solely on managing connected devices in the home.
When asked to calculate an average, **round to the nearest whole number** without explaining the calculation.
`

const defaultInstructions = `
Currently, there is no connected devices.
Your sole task is to ask the user to install one or more connected devices in the home before proceeding.
`

import axios from 'axios'
import yaml from 'js-yaml'

import locationsModel from './schemas/models/locations.json' with { type: 'json' }
import switchsModel from './schemas/models/switchs.json' with { type: 'json' }
import shuttersModel from './schemas/models/shutters.json' with { type: 'json' }

import updateSwitchsFunction from './schemas/functions/update_switchs.json' with { type: 'json' }
import updateShuttersFunction from './schemas/functions/update_shutters.json' with { type: 'json' }

async function getSystemInfo() {
  try {
    const response = await axios.get(`${baseUrl.getValue()}/rest/systeminfo`, {
      headers: {
        Authorization: `Bearer ${apiToken.getValue()}`,
      },
    })
    return response.data.systemInfo
  } catch (err) {
    extension.clearErrors()
    extension.addError(err.message)
    return {}
  }
}

async function getItems() {
  try {
    const response = await axios.get(`${baseUrl.getValue()}/rest/items`, {
      headers: {
        Authorization: `Bearer ${apiToken.getValue()}`,
      },
    })
    return response.data
  } catch (err) {
    extension.clearErrors()
    extension.addError(err.message)
    return []
  }
}

async function refresh() {
  const locations = []
  const switchs = []
  const shutters = []
  extension.clearErrors()
  const systemInfo = await getSystemInfo()
  extension.setSoftwareVersion(systemInfo.osVersion)
  for (const item of await getItems()) {
    if (item.type === 'Group' && item.tags.includes('Location')) {
      locations.push({
        id: item.name,
        name: item.label,
        location_id: item.groupNames.length ? item.groupNames[0] : null,
      })
    }
    if (item.type === 'Switch' && item.tags.includes('Equipment')) {
      switchs.push({
        id: item.name,
        name: item.label,
        state: item.state.toLowerCase(),
        location_id: item.groupNames.length ? item.groupNames[0] : null,
      })
    }
    if (item.type === 'Rollershutter' && item.tags.includes('Equipment')) {
      shutters.push({
        id: item.name,
        name: item.label,
        state: item.state === '0' ? 'opened' : 'closed',
        location_id: item.groupNames.length ? item.groupNames[0] : null,
      })
    }
  }

  const instructions = [baseInstructions]

  if (!switchs.length && !shutters.length) {
    instructions.push(defaultInstructions)
  } else {
    instructions.push('``` yaml')
    instructions.push(
      yaml.dump({
        locationsModel,
        switchsModel,
        shuttersModel,
        locations,
        switchs,
        shutters,
      }),
    )
    instructions.push('```')
  }

  extension.setInstructions(instructions.join('\n'))

  const functionSchemas = []
  if (switchs.length) {
    functionSchemas.push(updateSwitchsFunction)
  }
  if (shutters.length) {
    functionSchemas.push(updateShuttersFunction)
  }
  extension.setFunctionSchemas(functionSchemas)

  setTimeout(refresh, 5000)
}
refresh()

extension.setFunctions([
  async function update_switchs(action, ids) {
    try {
      for (const id of ids) {
        await axios.post(`${baseUrl.getValue()}/rest/items/${id}`, action.toUpperCase(), {
          headers: {
            Authorization: `Bearer ${apiToken.getValue()}`,
            'content-type': 'text/plain',
          },
        })
      }
      return 'Done.'
    } catch (err) {
      return `Error: ${err.message}`
    }
  },
  async function update_shutters(action, ids) {
    try {
      for (const id of ids) {
        await axios.post(`${baseUrl.getValue()}/rest/items/${id}`, action.toUpperCase(), {
          headers: {
            Authorization: `Bearer ${apiToken.getValue()}`,
            'content-type': 'text/plain',
          },
        })
      }
      return action === 'stop' ? 'Done.' : 'In progress.'
    } catch (err) {
      console.log(err)
      return `Error: ${err.message}`
    }
  },
])
