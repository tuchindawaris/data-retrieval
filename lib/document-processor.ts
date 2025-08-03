import { getDriveClient } from './google-drive'
import mammoth from 'mammoth'

export async function extractDocumentText(
  accessToken: string,
  fileId: string,
  fileName: string,
  mimeType: string
): Promise<string> {
  try {
    const drive = getDriveClient(accessToken)
    let text = ''
    
    // Handle Google Docs
    if (mimeType === 'application/vnd.google-apps.document') {
      try {
        // Export as plain text
        const response = await drive.files.export({
          fileId: fileId,
          mimeType: 'text/plain'
        }, { responseType: 'text' })
        
        text = response.data as string
      } catch (error: any) {
        console.error(`Error exporting Google Doc ${fileName}:`, error.message)
        // Try to get at least the file metadata
        try {
          const metaResponse = await drive.files.get({
            fileId: fileId,
            fields: 'name,description'
          })
          text = `[Google Doc: ${metaResponse.data.name}]${metaResponse.data.description ? '\n' + metaResponse.data.description : ''}`
        } catch {
          text = `[Unable to extract content from Google Doc: ${fileName}]`
        }
      }
    } 
    // Handle .docx files
    else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      try {
        // Download as buffer
        const response = await drive.files.get({
          fileId: fileId,
          alt: 'media'
        }, { responseType: 'arraybuffer' })
        
        const buffer = Buffer.from(response.data as ArrayBuffer)
        const result = await mammoth.extractRawText({ buffer })
        text = result.value
      } catch (error: any) {
        console.error(`Error downloading docx ${fileName}:`, error.message)
        text = `[Unable to extract content from docx: ${fileName}]`
      }
    }
    // Handle plain text files
    else if (mimeType === 'text/plain' || fileName.endsWith('.txt') || fileName.endsWith('.md')) {
      try {
        const response = await drive.files.get({
          fileId: fileId,
          alt: 'media'
        }, { responseType: 'text' })
        
        text = response.data as string
      } catch (error: any) {
        console.error(`Error downloading text file ${fileName}:`, error.message)
        text = `[Unable to extract content from text file: ${fileName}]`
      }
    }
    // Handle RTF (basic extraction - just remove formatting)
    else if (mimeType === 'application/rtf' || fileName.endsWith('.rtf')) {
      try {
        const response = await drive.files.get({
          fileId: fileId,
          alt: 'media'
        }, { responseType: 'text' })
        
        // Basic RTF stripping (removes most formatting)
        text = (response.data as string)
          .replace(/\\par[d]?/g, '\n')
          .replace(/\{\\.*?\}/g, '')
          .replace(/\\[a-z]+\d* ?/g, '')
          .trim()
      } catch (error: any) {
        console.error(`Error downloading RTF ${fileName}:`, error.message)
        text = `[Unable to extract content from RTF: ${fileName}]`
      }
    }
    
    // Truncate to reasonable length for API limits (roughly 4000 tokens ~ 16000 chars)
    if (text.length > 16000) {
      text = text.substring(0, 16000) + '... [truncated]'
    }
    
    return text
    
  } catch (error) {
    console.error(`Error extracting text from ${fileName}:`, error)
    return `[Unable to extract content from: ${fileName}]`
  }
}