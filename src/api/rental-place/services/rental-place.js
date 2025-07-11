'use strict';

/**
 * rental-place service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::rental-place.rental-place');
