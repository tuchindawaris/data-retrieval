import { google } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'

export function getOAuth2Client() {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
}

export function getDriveClient(accessToken: string) {
  const oauth2Client = getOAuth2Client()
  oauth2Client.setCredentials({ access_token: accessToken })
  return google.drive({ version: 'v3', auth: oauth2Client })
}

export async function listFolderContents(accessToken: string, folderId: string) {
  const drive = getDriveClient(accessToken)
  
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, size, modifiedTime, parents)',
    pageSize: 1000,
  })
  
  return response.data.files || []
}

export async function getFileMetadata(accessToken: string, fileId: string) {
  const drive = getDriveClient(accessToken)
  
  const response = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size, modifiedTime, parents, webViewLink',
  })
  
  return response.data
}

export function getAuthUrl() {
  const oauth2Client = getOAuth2Client()
  
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
    ],
    prompt: 'consent',
  })
}

export async function getTokenFromCode(code: string) {
  const oauth2Client = getOAuth2Client()
  const { tokens } = await oauth2Client.getToken(code)
  return tokens
}