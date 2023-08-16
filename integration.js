'use strict';
const request = require('postman-request');
const config = require('./config/config');
const async = require('async');
const fs = require('fs');
const { get, getOr, map } = require('lodash/fp');

let Logger;
let requestDefault;

/**
 *
 * @param entities
 * @param options
 * @param cb
 */

let previousDomainRegexAsString = '';

function doLookup(entities, options, cb) {
  let lookupResults = [];
  let tasks = [];

  Logger.trace({ entities: entities }, 'entities');

  entities.forEach((entity) => {
    //do the lookup
    let requestOptions = {
      method: 'GET',
      uri: `${options.url}/api/v3/files/` + entity.value,
      headers: {
        'X-Apikey': options.apiKey
      },
      json: true
    };

    Logger.debug({ uri: requestOptions }, 'Request URI');

    tasks.push(function (done) {
      requestDefault(requestOptions, function (error, res, body) {
        if (error) {
          done({
            error: error,
            entity: entity.value,
            detail: 'Error in Request'
          });
          return;
        }

        let result = {};

        if (res.statusCode === 200) {
          result = {
            entity: entity,
            body: body
          };
        } else if (res.statusCode === 429) {
          // reached rate limit
          error = {
            detail: 'Reached API Lookup Limit'
          };
        } else {
          // Non 200 status code
          done({
            error: error,
            httpStatus: res.statusCode,
            body: body,
            detail: 'Unexpected Non 200 HTTP Status Code',
            entity: entity.value
          });
          return;
        }
        Logger.trace({ result: result }, 'checking on the results');

        done(error, result);
      });
    });
  });

  async.parallelLimit(tasks, 10, (err, results) => {
    if (err) {
      cb(err);
      return;
    }

    results.forEach((result) => {
      if (result.body === null || _isMiss(result.body)) {
        lookupResults.push({
          entity: result.entity,
          data: null
        });
      } else {
        const data = get('body.data', result);
        const attributes = get('attributes', data);
        const rawSize = get('size', attributes);
        const rawCreationDate = get('creation_date', attributes);
        const occurrences = get('occurrences', attributes);
        lookupResults.push({
          entity: result.entity,
          data: {
            summary: getSummaryTags(result.body),
            details: {
              ...result.body,
              data: {
                ...data,
                isMalicious: getOr(
                  '',
                  'mal_eval_result.probability_bucket',
                  attributes
                ).includes('HIGH'),
                attributes: {
                  ...attributes,
                  ...(rawSize && {
                    size:
                      rawSize > 1000
                        ? `${(rawSize / 1000).toFixed(2)} KB`
                        : `${rawSize} bytes`
                  }),
                  ...(rawCreationDate && {
                    creation_date: rawCreationDate * 1000
                  }),
                  ...(occurrences && {
                    occurrences: map(
                      (occurrence) => JSON.stringify(occurrence),
                      occurrences
                    )
                  })
                }
              }
            }
          }
        });
      }
    });

    Logger.trace({ lookupResults: lookupResults }, 'Lookup Results');

    cb(null, lookupResults);
  });
}

function getSummaryTags(result) {
  const tags = [];

  const probabilityBucket = get(
    'data.attributes.mal_eval_result.probability_bucket',
    result
  );
  if (probabilityBucket) tags.push(probabilityBucket);

  return tags;
}

function _isMiss(body) {
  if (body && Array.isArray(body) && body.length === 0) {
    return true;
  }
  return false;
}

function startup(logger) {
  Logger = logger;

  let defaults = {};

  if (typeof config.request.cert === 'string' && config.request.cert.length > 0) {
    defaults.cert = fs.readFileSync(config.request.cert);
  }

  if (typeof config.request.key === 'string' && config.request.key.length > 0) {
    defaults.key = fs.readFileSync(config.request.key);
  }

  if (
    typeof config.request.passphrase === 'string' &&
    config.request.passphrase.length > 0
  ) {
    defaults.passphrase = config.request.passphrase;
  }

  if (typeof config.request.ca === 'string' && config.request.ca.length > 0) {
    defaults.ca = fs.readFileSync(config.request.ca);
  }

  if (typeof config.request.proxy === 'string' && config.request.proxy.length > 0) {
    defaults.proxy = config.request.proxy;
  }

  requestDefault = request.defaults(defaults);
}

function validateOptions(userOptions, cb) {
  let errors = [];
  if (
    typeof userOptions.apiKey.value !== 'string' ||
    (typeof userOptions.apiKey.value === 'string' &&
      userOptions.apiKey.value.length === 0)
  ) {
    errors.push({
      key: 'apiKey',
      message: 'You must provide a valid API key'
    });
  }
  cb(null, errors);
}

module.exports = {
  doLookup: doLookup,
  validateOptions: validateOptions,
  startup: startup
};
