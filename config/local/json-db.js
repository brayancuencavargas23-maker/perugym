const fs = require('fs');
const path = require('path');

const EXPORT_DIR = path.join(__dirname, '..', '..', 'db-export');

class JsonCollection {
  constructor(name) {
    this.name = name;
    this.filePath = path.join(EXPORT_DIR, `${name}.json`);
    this.data = [];
    this._load();
  }

  _load() {
    if (fs.existsSync(this.filePath)) {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
    } else {
      this.data = [];
    }
  }

  _save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  _matchesFilters(doc, filters) {
    if (!filters || Object.keys(filters).length === 0) return true;
    for (const [key, value] of Object.entries(filters)) {
      if (key === '$or') {
        if (!value.some(sub => this._matchesFilters(doc, sub))) return false;
        continue;
      }
      if (key === '$and') {
        if (!value.every(sub => this._matchesFilters(doc, sub))) return false;
        continue;
      }
      const docVal = this._getNested(doc, key);
      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        if ('$in' in value && !value.$in.includes(docVal)) return false;
        if ('$nin' in value && value.$nin.includes(docVal)) return false;
        if ('$ne' in value && docVal === value.$ne) return false;
        if ('$gt' in value && !(docVal > value.$gt)) return false;
        if ('$gte' in value && !(docVal >= value.$gte)) return false;
        if ('$lt' in value && !(docVal < value.$lt)) return false;
        if ('$lte' in value && !(docVal <= value.$lte)) return false;
        if ('$exists' in value) {
          if (value.$exists && docVal === undefined) return false;
          if (!value.$exists && docVal !== undefined) return false;
        }
        if ('$regex' in value) {
          const regex = new RegExp(value.$regex, value.$options || '');
          if (!regex.test(docVal || '')) return false;
        }
      } else {
        if (docVal !== value) return false;
      }
    }
    return true;
  }

  _getNested(obj, path) {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current == null) return undefined;
      current = current[part];
    }
    return current;
  }

  _applySort(docs, sort) {
    if (!sort || Object.keys(sort).length === 0) return docs;
    return [...docs].sort((a, b) => {
      for (const [key, dir] of Object.entries(sort)) {
        const aVal = this._getNested(a, key);
        const bVal = this._getNested(b, key);
        if (aVal < bVal) return -1 * dir;
        if (aVal > bVal) return 1 * dir;
      }
      return 0;
    });
  }

  _applyProjection(docs, projection) {
    if (!projection || Object.keys(projection).length === 0) return docs;
    const include = Object.entries(projection).filter(([, v]) => v === 1 || v === true);
    if (include.length > 0) {
      const keys = include.map(([k]) => k);
      return docs.map(doc => {
        const result = { _id: doc._id };
        for (const key of keys) {
          if (doc[key] !== undefined) result[key] = doc[key];
        }
        return result;
      });
    }
    const exclude = Object.entries(projection).filter(([, v]) => v === 0 || v === false);
    if (exclude.length > 0) {
      const keys = exclude.map(([k]) => k);
      return docs.map(doc => {
        const result = { ...doc };
        for (const key of keys) {
          delete result[key];
        }
        return result;
      });
    }
    return docs;
  }

  find(filters = {}, options = {}) {
    let results = this.data.filter(doc => this._matchesFilters(doc, filters));
    if (options.sort) results = this._applySort(results, options.sort);
    if (options.skip) results = results.slice(options.skip);
    if (options.limit) results = results.slice(0, options.limit);
    if (options.projection) results = this._applyProjection(results, options.projection);
    return {
      toObject: () => results,
      then: (resolve) => resolve(results),
      sort: function(s) { options.sort = s; return this; },
      skip: function(n) { options.skip = n; return this; },
      limit: function(n) { options.limit = n; return this; },
      select: function(p) { options.projection = p; return this; },
      populate: function() { return this; },
      lean: function() { return this; },
      [Symbol.asyncIterator]: async function* () { yield* results; },
    };
  }

  findOne(filters = {}, options = {}) {
    const doc = this.data.find(doc => this._matchesFilters(doc, filters));
    if (!doc) return null;
    let result = options.projection ? this._applyProjection([doc], options.projection)[0] : doc;
    return {
      ...result,
      toObject: () => result,
      populate: function() { return this; },
      lean: function() { return this; },
    };
  }

  findById(id, options = {}) {
    return this.findOne({ _id: id }, options);
  }

  async aggregate(pipeline) {
    let results = [...this.data];

    for (const stage of pipeline) {
      if (stage.$match) {
        results = results.filter(doc => this._matchesFilters(doc, stage.$match));
      }
      if (stage.$unwind) {
        const field = stage.$unwind.path || stage.$unwind;
        const newPath = field.replace(/^\$/, '');
        const newResults = [];
        for (const doc of results) {
          const arr = doc[newPath];
          if (Array.isArray(arr) && arr.length > 0) {
            for (const item of arr) {
              newResults.push({ ...doc, [newPath]: item });
            }
          } else if (Array.isArray(arr) && arr.length === 0 && stage.$unwind.preserveNullAndEmptyArrays) {
            newResults.push({ ...doc, [newPath]: null });
          }
        }
        results = newResults;
      }
      if (stage.$group) {
        const groups = new Map();
        for (const doc of results) {
          let groupKey;
          if (stage.$group._id === null) {
            groupKey = '__null__';
          } else if (typeof stage.$group._id === 'string') {
            groupKey = doc[stage.$group._id.replace(/^\$/, '')];
          } else {
            groupKey = JSON.stringify(
              Object.fromEntries(
                Object.entries(stage.$group._id).map(([k, v]) => [k, typeof v === 'string' ? doc[v.replace(/^\$/, '')] : v])
              )
            );
          }
          if (!groups.has(groupKey)) groups.set(groupKey, []);
          groups.get(groupKey).push(doc);
        }
        results = [];
        for (const [key, docs] of groups) {
          const grouped = stage.$group._id === null ? { _id: null } : { _id: key === '__null__ ? null : JSON.parse(key)' };
          if (stage.$group._id === null) {
            grouped._id = null;
          } else if (key !== '__null__') {
            try { Object.assign(grouped, JSON.parse(key)); } catch { grouped._id = key; }
          }
          for (const [field, op] of Object.entries(stage.$group)) {
            if (field === '_id') continue;
            if (op.$sum) {
              if (op.$sum === 1) {
                grouped[field] = docs.length;
              } else {
                const sumField = op.$sum.replace(/^\$/, '');
                grouped[field] = docs.reduce((sum, d) => sum + (parseFloat(d[sumField]) || 0), 0);
              }
            }
            if (op.$avg) {
              const avgField = op.$avg.replace(/^\$/, '');
              grouped[field] = docs.reduce((sum, d) => sum + (parseFloat(d[avgField]) || 0), 0) / docs.length;
            }
            if (op.$first) {
              const firstField = op.$first.replace(/^\$/, '');
              grouped[field] = docs[0][firstField];
            }
            if (op.$push) {
              const pushField = op.$push.replace(/^\$/, '');
              grouped[field] = docs.map(d => d[pushField]);
            }
          }
          results.push(grouped);
        }
      }
      if (stage.$project) {
        results = this._applyProjection(results, stage.$project);
      }
      if (stage.$sort) {
        results = this._applySort(results, stage.$sort);
      }
      if (stage.$skip) {
        results = results.slice(stage.$skip);
      }
      if (stage.$limit) {
        results = results.slice(0, stage.$limit);
      }
    }
    return results;
  }

  create(doc) {
    const newDoc = {
      _id: doc._id || require('mongoose').Types.ObjectId().toString(),
      ...doc,
    };
    this.data.push(newDoc);
    this._save();
    return { ...newDoc, toObject: () => newDoc };
  }

  insertMany(docs) {
    return docs.map(d => this.create(d));
  }

  findOneAndUpdate(filters, update, options = {}) {
    const idx = this.data.findIndex(doc => this._matchesFilters(doc, filters));
    if (idx === -1) return null;
    if (update.$set) {
      Object.assign(this.data[idx], update.$set);
    } else {
      Object.assign(this.data[idx], update);
    }
    this._save();
    const doc = this.data[idx];
    return { ...doc, toObject: () => doc };
  }

  updateOne(filters, update) {
    const idx = this.data.findIndex(doc => this._matchesFilters(doc, filters));
    if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
    if (update.$set) {
      Object.assign(this.data[idx], update.$set);
    } else {
      Object.assign(this.data[idx], update);
    }
    this._save();
    return { matchedCount: 1, modifiedCount: 1 };
  }

  updateMany(filters, update) {
    let count = 0;
    this.data.forEach((doc, idx) => {
      if (this._matchesFilters(doc, filters)) {
        if (update.$set) {
          Object.assign(this.data[idx], update.$set);
        } else {
          Object.assign(this.data[idx], update);
        }
        count++;
      }
    });
    this._save();
    return { matchedCount: count, modifiedCount: count };
  }

  deleteOne(filters) {
    const idx = this.data.findIndex(doc => this._matchesFilters(doc, filters));
    if (idx === -1) return { deletedCount: 0 };
    this.data.splice(idx, 1);
    this._save();
    return { deletedCount: 1 };
  }

  deleteMany(filters) {
    const before = this.data.length;
    this.data = this.data.filter(doc => !this._matchesFilters(doc, filters));
    this._save();
    return { deletedCount: before - this.data.length };
  }

  countDocuments(filters = {}) {
    return this.data.filter(doc => this._matchesFilters(doc, filters)).length;
  }

  exists(filters) {
    return this.data.some(doc => this._matchesFilters(doc, filters));
  }
}

class JsonDatabase {
  constructor() {
    this.collections = {};
  }

  collection(name) {
    if (!this.collections[name]) {
      this.collections[name] = new JsonCollection(name);
    }
    return this.collections[name];
  }

  listCollections() {
    const files = fs.readdirSync(EXPORT_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => ({ name: f.replace('.json', '') }));
  }
}

const db = new JsonDatabase();

module.exports = { db, JsonCollection, JsonDatabase };
