import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getLanguage,
  getLanguageById,
  getAllLanguages,
  isLanguageSupported,
} from "../../src/core/languages/languageRegistry.ts";

describe("LanguageRegistry", () => {
  describe("getAllLanguages", () => {
    it("should return an array of languages", () => {
      const languages = getAllLanguages();
      assert.ok(Array.isArray(languages));
      assert.ok(languages.length >= 2, "Should have at least Python and C");
    });

    it("should return languages with required fields", () => {
      const requiredFields = [
        "id",
        "name",
        "version",
        "description",
        "memory_limit_mb",
        "cpu_limit",
        "timeout_ms",
        "features",
        "example",
      ];

      for (const lang of getAllLanguages()) {
        for (const field of requiredFields) {
          assert.ok(
            lang[field] !== undefined,
            `${lang.id} missing field: ${field}`,
          );
        }
      }
    });

    it("should return languages with unique IDs", () => {
      const languages = getAllLanguages();
      const ids = languages.map((l) => l.id);
      const uniqueIds = new Set(ids);
      assert.equal(ids.length, uniqueIds.size, "Language IDs must be unique");
    });
  });

  describe("getLanguage", () => {
    it("should return Python by direct ID", () => {
      const python = getLanguage("python");
      assert.ok(python);
      assert.equal(python.id, "python");
      assert.equal(python.version, "3.12");
    });

    it("should return C by direct ID", () => {
      const c = getLanguage("c");
      assert.ok(c);
      assert.equal(c.id, "c");
      assert.equal(c.version, "GCC 13");
    });

    it("should resolve Python aliases", () => {
      assert.equal(getLanguage("py")?.id, "python");
      assert.equal(getLanguage("python3")?.id, "python");
    });

    it("should resolve C aliases", () => {
      assert.equal(getLanguage("gcc")?.id, "c");
    });

    it("should be case-insensitive", () => {
      assert.equal(getLanguage("Python")?.id, "python");
      assert.equal(getLanguage("PYTHON")?.id, "python");
      assert.equal(getLanguage("C")?.id, "c");
    });

    it("should return null for unsupported languages", () => {
      assert.equal(getLanguage("rust"), null);
      assert.equal(getLanguage("golang"), null);
      assert.equal(getLanguage(""), null);
    });

    it("should handle null/undefined input", () => {
      assert.equal(getLanguage(null), null);
      assert.equal(getLanguage(undefined), null);
    });
  });

  describe("getLanguageById", () => {
    it("should be an alias for getLanguage", () => {
      assert.equal(getLanguageById("python")?.id, "python");
      assert.equal(getLanguageById("py")?.id, "python");
      assert.equal(getLanguageById("java")?.id, "java");
      assert.equal(getLanguageById("rust"), null);
    });
  });

  describe("isLanguageSupported", () => {
    it("should return true for supported languages", () => {
      assert.equal(isLanguageSupported("python"), true);
      assert.equal(isLanguageSupported("c"), true);
      assert.equal(isLanguageSupported("java"), true);
    });

    it("should return true for aliases", () => {
      assert.equal(isLanguageSupported("py"), true);
      assert.equal(isLanguageSupported("gcc"), true);
      assert.equal(isLanguageSupported("java21"), true);
    });

    it("should return false for unsupported languages", () => {
      assert.equal(isLanguageSupported("ruby"), false);
      assert.equal(isLanguageSupported("golang"), false);
    });
  });

  describe("Language features", () => {
    it("should define features object for each language", () => {
      for (const lang of getAllLanguages()) {
        const features = lang.features;
        assert.ok(features, `${lang.id} missing features`);
        assert.equal(typeof features.stdin, "boolean");
        assert.equal(typeof features.file_io, "boolean");
        assert.equal(typeof features.networking, "boolean");
      }
    });

    it("C should have compiler_flags_allowed", () => {
      const c = getLanguage("c");
      assert.ok(c);
      assert.ok(c.compiler_flags_default);
      assert.ok(Array.isArray(c.compiler_flags_allowed));
      assert.ok(c.compiler_flags_allowed.length > 0);
    });

    it("Python should have zero compile_time_ms", () => {
      const python = getLanguage("python");
      assert.ok(python);
      assert.equal(python.compile_time_ms, 0);
    });

    it("each language should have an example", () => {
      for (const lang of getAllLanguages()) {
        assert.ok(
          lang.example && lang.example.length > 0,
          `${lang.id} missing example code`,
        );
      }
    });
  });
});
