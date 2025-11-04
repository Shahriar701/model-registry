import { VersionUtils } from '../../src/utils/version-utils';

describe('VersionUtils', () => {
  describe('parseVersion', () => {
    it('should parse valid semantic version', () => {
      const result = VersionUtils.parseVersion('1.2.3');
      expect(result).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    it('should throw error for invalid version format', () => {
      expect(() => VersionUtils.parseVersion('1.2')).toThrow('Invalid semantic version format: 1.2');
      expect(() => VersionUtils.parseVersion('v1.2.3')).toThrow('Invalid semantic version format: v1.2.3');
    });
  });

  describe('compareVersions', () => {
    it('should compare versions correctly', () => {
      expect(VersionUtils.compareVersions('1.0.0', '1.0.0')).toBe(0);
      expect(VersionUtils.compareVersions('1.0.1', '1.0.0')).toBe(1);
      expect(VersionUtils.compareVersions('1.0.0', '1.0.1')).toBe(-1);
      expect(VersionUtils.compareVersions('1.1.0', '1.0.9')).toBe(1);
      expect(VersionUtils.compareVersions('2.0.0', '1.9.9')).toBe(1);
    });
  });

  describe('isGreaterThan', () => {
    it('should return true when first version is greater', () => {
      expect(VersionUtils.isGreaterThan('1.0.1', '1.0.0')).toBe(true);
      expect(VersionUtils.isGreaterThan('1.1.0', '1.0.9')).toBe(true);
      expect(VersionUtils.isGreaterThan('2.0.0', '1.9.9')).toBe(true);
    });

    it('should return false when first version is not greater', () => {
      expect(VersionUtils.isGreaterThan('1.0.0', '1.0.1')).toBe(false);
      expect(VersionUtils.isGreaterThan('1.0.0', '1.0.0')).toBe(false);
    });
  });

  describe('sortVersionsAscending', () => {
    it('should sort versions in ascending order', () => {
      const versions = ['1.2.0', '1.0.0', '1.1.0', '2.0.0', '1.0.1'];
      const sorted = VersionUtils.sortVersionsAscending(versions);
      expect(sorted).toEqual(['1.0.0', '1.0.1', '1.1.0', '1.2.0', '2.0.0']);
    });
  });

  describe('sortVersionsDescending', () => {
    it('should sort versions in descending order', () => {
      const versions = ['1.2.0', '1.0.0', '1.1.0', '2.0.0', '1.0.1'];
      const sorted = VersionUtils.sortVersionsDescending(versions);
      expect(sorted).toEqual(['2.0.0', '1.2.0', '1.1.0', '1.0.1', '1.0.0']);
    });
  });

  describe('getLatestVersion', () => {
    it('should return the latest version', () => {
      const versions = ['1.2.0', '1.0.0', '1.1.0', '2.0.0', '1.0.1'];
      const latest = VersionUtils.getLatestVersion(versions);
      expect(latest).toBe('2.0.0');
    });

    it('should return null for empty array', () => {
      const latest = VersionUtils.getLatestVersion([]);
      expect(latest).toBeNull();
    });
  });

  describe('isValidSemanticVersion', () => {
    it('should validate semantic version format', () => {
      expect(VersionUtils.isValidSemanticVersion('1.0.0')).toBe(true);
      expect(VersionUtils.isValidSemanticVersion('10.20.30')).toBe(true);
      expect(VersionUtils.isValidSemanticVersion('1.0')).toBe(false);
      expect(VersionUtils.isValidSemanticVersion('v1.0.0')).toBe(false);
      expect(VersionUtils.isValidSemanticVersion('1.0.0-beta')).toBe(false);
    });
  });

  describe('getNextVersions', () => {
    it('should generate next patch version', () => {
      expect(VersionUtils.getNextPatchVersion('1.0.0')).toBe('1.0.1');
      expect(VersionUtils.getNextPatchVersion('1.2.9')).toBe('1.2.10');
    });

    it('should generate next minor version', () => {
      expect(VersionUtils.getNextMinorVersion('1.0.0')).toBe('1.1.0');
      expect(VersionUtils.getNextMinorVersion('1.9.5')).toBe('1.10.0');
    });

    it('should generate next major version', () => {
      expect(VersionUtils.getNextMajorVersion('1.0.0')).toBe('2.0.0');
      expect(VersionUtils.getNextMajorVersion('9.5.3')).toBe('10.0.0');
    });
  });
});