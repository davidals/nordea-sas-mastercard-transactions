const puppeteer = require('puppeteer')
const path = require('path')
const fs = require('fs')

async function downloadTransactionsExcel(browser, downloadPath) {
  const page = await goToTransactionsPage(browser, downloadPath)

  console.log('\n=== DOWNLOADING EXCEL FILE ===')

  // Click the "Exportera till Excel" button
  const downloaded = await page.evaluate(() => {
    // The export button is icon-only; its label is in aria-label
    const excelButton = [...document.querySelectorAll('button')].find(btn =>
      (btn.getAttribute('aria-label') || btn.textContent || '').includes('Exportera till Excel')
    )

    if (excelButton) {
      excelButton.click()
      return { success: true }
    }
    return { success: false, error: 'Excel export button not found' }
  })

  if (!downloaded.success) {
    console.log(`✗ Failed to click Excel export button: ${downloaded.error}`)
    return null
  }

  console.log('✓ Clicked "Exportera till Excel" button')
  console.log('⏳ Waiting for download to complete...')

  // Wait for the download to complete (adjust timeout as needed)
  await page.waitForTimeout(5000)

  console.log('✓ Download complete!')

  // Return the download path so caller can process the file
  return downloadPath
}

async function goToTransactionsPage(browser, downloadPath) {
  const page = await browser.newPage()

  // Set up download behavior
  const client = await page.target().createCDPSession()
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadPath
  })

  await page.goto('https://my.saseurobonusmastercard.se/nis/mypages/login/', {waitUntil: 'networkidle0'})

  // Wait for the BankID login button with the new selector
  await page.waitForSelector('button[provider="bankid-se"]')
  const loginButton = await page.$('button[provider="bankid-se"]')
  if (loginButton) {
    await loginButton.click()
  }

  await page.waitForFunction(() => {
    const h1s = Array.from(document.querySelectorAll('h1'))
    return h1s.some(h1 => h1.textContent.trim() === 'Välj kort')
  })

  await page.goto('https://my.saseurobonusmastercard.se/nis/mypages/sv-SE/account/4a339e3e84d8ea54-1003210102/')

  // Wait for the transactions list and the export button to render
  await page.waitForSelector('button[aria-label="Exportera till Excel"]')

  console.log('✓ Navigated to transactions page')

  return page
}

module.exports = {
  downloadTransactionsExcel
}
