const express = require('express')
const { google } = require('googleapis')
const { authenticate } = require('@google-cloud/local-auth')
const app = express()
const path = require('path')
const fs = require('fs').promises
const dotenv = require('dotenv')

// Loads environment variables from 'backend/config.env'
dotenv.config({ path: 'backend/config.env' })

// Scopes basically define the permissions for a Gmail account.
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://mail.google.com/'
]

// Name of the label for vacation emails
const labelName = 'Vacation Mails'

// Async function to handle Gmail auto-reply
const GmailAutoReply = async (req, res) => {
  try {
    // Authenticate with Google Gmail using local credentials
    const auth = await authenticate({
      keyfilePath: path.join(__dirname, 'credentials.json'),
      scopes: SCOPES
    })

    // Set up Google Gmail API object
    const gmail = google.gmail({ version: 'v1', auth })

    const labelId = await createOrGetLabelId(gmail, auth)

    startAutoReply(gmail, auth, labelId)

    res.json({ 'this is Auth': auth })
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' })
  }
}

// Function to create or retrieve the label ID for vacation emails
async function createOrGetLabelId (gmail, auth) {
  try {
    const response = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: labelName,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show'
      }
    })
    return response.data.id
  } catch (error) {
    if (error.code === 409) {
      const response = await gmail.users.labels.list({ userId: 'me' })
      const label = response.data.labels.find(label => label.name === labelName)
      return label.id
    } else {
      throw error
    }
  }
}

// Function to get a random time interval between 45 to 120 seconds
function getRandomInterval () {
  return Math.floor(Math.random() * (120 - 45 + 1) + 45) * 1000
}

// Function to start the auto-reply functionality
async function startAutoReply (gmail, auth, labelId) {
  setInterval(async () => {
    const unrepliedMessages = await getUnrepliedMessages(gmail, auth)
    if (unrepliedMessages.length > 0) {
      for (const message of unrepliedMessages) {
        const hasReplied = await checkIfReplied(gmail, auth, message.id)
        if (!hasReplied) {
          const email = await getEmailData(gmail, auth, message.id)
          const replyMessage = craftReplyMessage(email)
          await sendAndModifyEmail(
            gmail,
            auth,
            message.id,
            replyMessage,
            labelId
          )
        }
      }
    }
  }, getRandomInterval())
}

// Function to get unreplied/unseen messages from the Inbox
async function getUnrepliedMessages (gmail, auth) {
  const response = await gmail.users.messages.list({
    userId: 'me',
    labelIds: ['INBOX'],
    q: 'is:unread'
  })
  return response.data.messages || []
}

// Function to check if a reply has been sent for a message
async function checkIfReplied (gmail, auth, messageId) {
  const messageData = await gmail.users.messages.get({
    auth,
    userId: 'me',
    id: messageId
  })
  return messageData.data.payload.headers.some(
    header => header.name === 'In-Reply-To'
  )
}

// Function to get details of a specific email message
async function getEmailData (gmail, auth, messageId) {
  const messageData = await gmail.users.messages.get({
    auth,
    userId: 'me',
    id: messageId
  })
  return messageData.data
}

// Function to craft the auto-reply message
function craftReplyMessage (email) {
  return {
    userId: 'me',
    resource: {
      raw: Buffer.from(
        `To: ${
          email.payload.headers.find(header => header.name === 'From').value
        }\r\n` +
          `Subject: Re: ${
            email.payload.headers.find(header => header.name === 'Subject')
              .value
          }\r\n` +
          `Content-Type: text/plain; charset="UTF-8"\r\n` +
          `Content-Transfer-Encoding: 7bit\r\n\r\n` +
          `Thank you very much for your email. I'm currently on vacation and will get back to you as soon as I can.\r\n`
      ).toString('base64')
    }
  }
}

// Function to send the auto-reply message and modify email labels
async function sendAndModifyEmail (
  gmail,
  auth,
  messageId,
  replyMessage,
  labelId
) {
  await gmail.users.messages.send(replyMessage)
  await gmail.users.messages.modify({
    auth,
    userId: 'me',
    id: messageId,
    resource: { addLabelIds: [labelId], removeLabelIds: ['INBOX'] }
  })
}

// Route handling
app.get('/', GmailAutoReply)

module.exports = app
