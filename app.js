require('dotenv').load({ silent: true });

const express = require('express');
const co = require('co');
const bodyParser = require('body-parser');
const AWS = require('aws-sdk');
const authS3O = require('s3o-middleware');
const authenticate = require('./authenticate');
const path = require('path');
const compression = require('compression');
const config = require('./config');
const { notFound, errorMiddleware } = require('./errors');

const app = new express();

AWS.config.update({
  accessKeyId: config.awsAccessKeyId,
  secretAccessKey: config.awsSecretAccessKey,
  region: config.awsRegion
});
const tableName = 'ft-email_platform_tps_lookup';

const docClient = new AWS.DynamoDB.DocumentClient();

function validateNumber(phoneNum) {
  return /^0(?!044)[\d ]+$/.test(phoneNum);
}

app.use(compression());
app.use(bodyParser.json());

app.post('/search', authenticate, (req, res, next) => {
  // check body with regex for british phone number
  if (!Array.isArray(req.body)) {
    return next({ message: 'Must provide array of numbers', status: 400 })
  }
  co(function* () {
    const results = yield req.body.map(function* (num) {
      if (!validateNumber(num)) {
        return next({ message: `${num} does not match formate 0xxxxxxxxxx`, status: 400 })
      }
      const params = {
        TableName: tableName,
        Key: {
          phone: num.replace(/\s/g, '')
        }
      };

      const result = yield docClient.get(params).promise();
      if (result.Item) {
        const updateParams = Object.assign({}, params,
            {
              ExpressionAttributeNames: {
                '#d': 'lastRetrieved'
              },
              ExpressionAttributeValues: {
                ':d': JSON.stringify(new Date())
              },
              UpdateExpression: 'SET #d = :d'
            });
        yield docClient.update(updateParams).promise();
      }

      return Promise.resolve({
        number: num,
        canCall: result.Item ? false : true
      });
    });
    res.json({ results });
  }).catch((err) => {
    console.log(err);
    next({ message: 'Something went wrong' });
  });
});

app.use(express.static(`${__dirname}/dist`));
app.use(authS3O);
app.get('/*', (req, res, next) => {
  res.sendFile(`${__dirname}/index.html`);
});

app.use(notFound);
app.use(errorMiddleware);

app.listen(config.PORT, () => {
  console.log(`App listening on port ${config.PORT}`);
});
