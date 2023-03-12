# YNAB Transactions Importer 

This node script will fetch those transactions for you and send it to YNAB through its API

## Supported sources

### Credit cards

* SAS Mastercard

### Banks

* Nordea


## Before using...

You will need to get your Ynab access token, account id and budget id.
See how to get those here: https://api.youneedabudget.com

## Usage

```
### Checkout the repo, and inside your working dir, do:

# first time only
npm install 

# SAS Mastercard Import
node bin/sas-master-to-ynab.js \ 
    <12-digit personummer> \ 
    <Ynab Access Token> \ 
    <Ynab Budget Id> \
    <Ynab Account Id> 
    
# Nordea Import 
node bin/nordea-to-ynab.js \
    <12-digit personummer> \
    <Ynab Access Token> \
    <Ynab Budget Id> \
    <Ynab Account Id> \
    <Start date with format YYYY-MM-DD>
    
### API
node bin/api.js

# then, to test it
curl localhost:5000 
```

## Requirements

* Node 8.x
* NPM

## On Mac M1

* You need to install chrome using `brew install chromium`.
* Then Allow Mac to open it freely: `xattr -cr /Applications/Chromium.app`
* Then before running NPM install, make sure puppeteer can't install its own Chromium by ```
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=`which chromium` ```
* Finally install rosetta-2 to allow using Chromium: `softwareupdate --install-rosetta`

Now you can run it

# launch.json example for mac M1
```
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "node",
            "request": "launch",
            "name": "Launch Program",
            "skipFiles": [
                "<node_internals>/**"
            ],
            "program": "${workspaceFolder}/bin/sas-master-to-ynab.js",
            "args": [
                "198909141254",
                "d694777afc5da85f7e49c46ca7609ecd80ba5b75cf9193614e49e13402ee6e6c",
                "eda4b693-9e4e-4a88-9cdb-3bd8528c7a57",
                "061b52d7-a0af-4a30-87e1-963f2dca2030"
            ],
            "env": {
                "PUPPETEER_EXECUTABLE_PATH":"/opt/homebrew/bin/chromium"
            }
        }
    ]
}
```
