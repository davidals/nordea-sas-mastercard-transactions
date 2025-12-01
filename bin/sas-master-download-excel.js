const puppeteer = require('puppeteer')
const path = require('path')
const os = require('os')
const { downloadTransactionsExcel } = require('../lib/sas-master-excel')

let browser

async function main() {
  try {
    // Set up download directory
    const downloadPath = path.join(os.homedir(), 'Downloads')
    console.log(`Download directory: ${downloadPath}`)

    browser = await puppeteer.launch({ headless: false })
    console.log('>>> Open BankID and authorise (30s to timeout)')

    const result = await downloadTransactionsExcel(browser, downloadPath)

    if (result) {
      console.log(`\n✓ Excel file downloaded to: ${result}`)
      console.log('Check your Downloads folder for the file!')
    } else {
      console.log('\n✗ Failed to download Excel file')
    }

  } catch (error) {
    console.error('Error:', error)
  } finally {
    if (browser) {
      console.log('\nClosing browser in 5 seconds...')
      await new Promise(resolve => setTimeout(resolve, 5000))
      await browser.close()
    }
  }
}

main()
