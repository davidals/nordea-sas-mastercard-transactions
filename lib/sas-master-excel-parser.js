const XLSX = require('xlsx')
const path = require('path')

function parseExcelTransactions(filePath) {
  console.log(`\n=== PARSING EXCEL FILE ===`)
  console.log(`File: ${filePath}`)

  // Read the Excel file
  const workbook = XLSX.readFile(filePath)
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]

  // Convert to array of arrays (raw data)
  const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

  console.log(`Total rows in file: ${rawData.length}`)

  // Find the header row (should be row 3, with "Datum")
  let headerRowIndex = -1
  for (let i = 0; i < rawData.length; i++) {
    if (rawData[i][0] === 'Datum') {
      headerRowIndex = i
      break
    }
  }

  if (headerRowIndex === -1) {
    throw new Error('Could not find header row with "Datum"')
  }

  console.log(`Header row found at index: ${headerRowIndex}`)

  // Get column headers
  const headers = rawData[headerRowIndex]
  console.log('Column headers:', headers)

  // Parse transactions starting from the row after headers
  const transactions = []
  let currentSection = 'Account' // Default section for account-level transactions
  let currentCard = null // Track the current card number

  for (let i = headerRowIndex + 1; i < rawData.length; i++) {
    const row = rawData[i]

    // Skip empty rows
    if (!row || row.length === 0 || !row[0]) {
      continue
    }

    // Check if this is a section header (e.g., card holder name)
    // Section headers typically have text in first column but not a date
    const firstCell = row[0] ? row[0].toString().trim() : ''

    // Detect section headers - they usually contain text but aren't dates
    // and the row might have "Datum" or "Specifikation" indicating a new section
    if (row[0] === 'Datum' && row[2] === 'Specifikation') {
      // This is a repeated header row for a new section, skip it
      continue
    }

    // Check if this is a card number (e.g., "525412******1317")
    if (firstCell.match(/^\d{6}\*+\d{4}$/)) {
      currentCard = firstCell
      currentSection = currentCard
      console.log(`Found card: ${currentCard}`)
      continue
    }

    // Check if this is a "Köp/uttag" subsection header
    if (firstCell === 'Köp/uttag') {
      // This is a subsection, keep the current card but mark it
      if (currentCard) {
        currentSection = currentCard
      }
      continue
    }

    // Check if this is an exchange rate line (not a section header)
    if (firstCell.startsWith('Valutakurs:')) {
      // Skip these - they're not section headers
      continue
    }

    // Check if this is any other section title (contains text but no date/amount)
    if (firstCell && !firstCell.match(/^\d{4}-\d{2}-\d{2}/) && !row[6] && firstCell !== '') {
      // This might be a card holder name or section title
      // Only use it if we don't have a current card
      if (!currentCard) {
        currentSection = firstCell
        console.log(`Found section: ${currentSection}`)
      }
      continue
    }

    const datum = row[0]            // Transaction date
    const bokfort = row[1]          // Booking date
    const specifikation = row[2]    // Merchant name
    const ort = row[3]              // City
    const valuta = row[4]           // Currency
    const utlBelopp = row[5]        // Foreign amount
    const belopp = row[6]           // Amount in SEK

    // Skip if missing essential data
    if (!datum || !specifikation || belopp === undefined || belopp === null) {
      continue
    }

    // Skip if specifikation is "Specifikation" (it's a header)
    if (specifikation === 'Specifikation') {
      continue
    }

    // Convert Excel date serial number to proper date if needed
    let transactionDate
    if (typeof datum === 'number') {
      // Excel date serial number
      transactionDate = excelDateToJSDate(datum)
    } else if (typeof datum === 'string') {
      // Already a string date like "2025-09-30"
      transactionDate = new Date(datum)
    } else {
      transactionDate = datum
    }

    const transaction = {
      date: formatDateToISO(transactionDate),
      payee: specifikation.toString().trim(),
      amount: belopp.toString(),
      isCleared: true, // Assuming all transactions in the export are cleared
      city: ort || '',
      currency: valuta || 'SEK',
      foreignAmount: utlBelopp || 0,
      source: currentSection // Track which section/card this came from
    }

    transactions.push(transaction)
  }

  console.log(`Parsed ${transactions.length} transactions`)
  console.log('='.repeat(80))

  return transactions
}

// Convert Excel date serial number to JavaScript Date
function excelDateToJSDate(serial) {
  const utc_days = Math.floor(serial - 25569)
  const utc_value = utc_days * 86400
  const date_info = new Date(utc_value * 1000)
  return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate())
}

// Format date to ISO string (YYYY-MM-DD)
function formatDateToISO(date) {
  if (typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return date // Already in correct format
  }

  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

module.exports = {
  parseExcelTransactions
}
