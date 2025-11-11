import { VersionUtils, SemanticVersion } from '../../utils/version-utils';

describe('VersionUtils', () => {
  describe('parseVersion', () => {
    it('should parse valid semantic version', () => {
      const result = VersionUtils.parseVersion('1.2.3');
      expect(result).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
      });
    });

    it('should parse version with zeros', () => {
      const result = VersionUtils.parseVersion('0.0.1');
      expect(result).toEqual({
        major: 0,
        minor: 0,
        patch: 1,
      });
    });

    it('should parse version with large numbers', () => {
      const result = VersionUtils.parseVersion('10.20.30');
      expect(result).toEqual({
        major: 10,
        minor: 20,
        patch: 30,
      });
    });

    it('should throw error for invalid version format', () => {
      expect(() => VersionUtils.parseVersion('1.2')).toThrow('Invalid semantic version format: 1.2');
      expect(() => VersionUtils.parseVersion('1.2.3.4')).toThrow('Invalid semantic version format: 1.2.3.4');
      expect(() => VersionUtils.parseVersion('v1.2.3')).toThrow('Invalid semantic version format: v1.2.3');
      expect(() => VersionUtils.parseVersion('1.2.beta')).toThrow('Invalid semantic version format: 1.2.beta');
    });
  });

  describe('compareVersions', () => {
    it('should return 0 for equal versions', () => {
      expect(VersionUtils.compareVersions('1.2.3', '1.2.3')).toBe(0);
      expect(VersionUtils.compareVersions('0.0.0', '0.0.0')).toBe(0);
    });

    it('should return 1 when first version is greater', () => {
      expect(VersionUtils.compareVersions('2.0.0', '1.9.9')).toBe(1);
      expect(VersionUtils.compareVersions('1.3.0', '1.2.9')).toBe(1);
      expect(VersionUtils.compareVersions('1.2.4', '1.2.3')).toBe(1);
    });

    it('should return -1 when first version is less', () => {
      expect(VersionUtils.compareVersions('1.9.9', '2.0.0')).toBe(-1);
      expect(VersionUtils.compareVersions('1.2.9', '1.3.0')).toBe(-1);
      expect(VersionUtils.compareVersions('1.2.3', '1.2.4')).toBe(-1);
    });

    it('should handle major version differences', () => {
      expect(VersionUtils.compareVersions('2.0.0', '1.99.99')).toBe(1);
      expect(VersionUtils.compareVersions('1.0.0', '2.0.0')).toBe(-1);
    });

    it('should handle minor version differences', () => {
      expect(VersionUtils.compareVersions('1.2.0', '1.1.99')).toBe(1);
      expect(VersionUtils.compareVersions('1.1.0', '1.2.0')).toBe(-1);
    });

    it('should handle patch version differences', () => {
      expect(VersionUtils.compareVersions('1.2.3', '1.2.2')).toBe(1);
      expect(VersionUtils.compareVersions('1.2.2', '1.2.3')).toBe(-1);
    });
  });

  describe('isGreaterThan', () => {
    it('should return true when first version is greater', () => {
      expect(VersionUtils.isGreaterThan('2.0.0', '1.9.9')).toBe(true);
      expect(VersionUtils.isGreaterThan('1.3.0', '1.2.9')).toBe(true);
      expect(VersionUtils.isGreaterThan('1.2.4', '1.2.3')).toBe(true);
    });

    it('should return false when first version is not greater', () => {
      expect(VersionUtils.isGreaterThan('1.2.3', '1.2.3')).toBe(false);
      expect(VersionUtils.isGreaterThan('1.2.3', '1.2.4')).toBe(false);
    });
  });

  describe('isLessThan', () => {
    it('should return true when first version is less', () => {
      expect(VersionUtils.isLessThan('1.9.9', '2.0.0')).toBe(true);
      expect(VersionUtils.isLessThan('1.2.9', '1.3.0')).toBe(true);
      expect(VersionUtils.isLessThan('1.2.3', '1.2.4')).toBe(true);
    });

    it('should return false when first version is not less', () => {
      expect(VersionUtils.isLessThan('1.2.3', '1.2.3')).toBe(false);
      expect(VersionUtils.isLessThan('1.2.4', '1.2.3')).toBe(false);
    });
  });

  describe('isEqual', () => {
    it('should return true for equal versions', () => {
      expect(VersionUtils.isEqual('1.2.3', '1.2.3')).toBe(true);
      expect(VersionUtils.isEqual('0.0.0', '0.0.0')).toBe(true);
    });

    it('should return false for different versions', () => {
      expect(VersionUtils.isEqual('1.2.3', '1.2.4')).toBe(false);
      expect(VersionUtils.isEqual('1.2.3', '1.3.3')).toBe(false);
      expect(VersionUtils.isEqual('1.2.3', '2.2.3')).toBe(false);
    });
  });

  describe('sortVersionsAscending', () => {
    it('should sort versions in ascending order', () => {
      const versions = ['2.0.0', '1.0.0', '1.2.0', '1.1.0', '1.1.1'];
      const sorted = VersionUtils.sortVersionsAscending(versions);
      
      expect(sorted).toEqual(['1.0.0', '1.1.0', '1.1.1', '1.2.0', '2.0.0']);
    });

    it('should not modify original array', () => {
      const versions = ['2.0.0', '1.0.0'];
      const sorted = VersionUtils.sortVersionsAscending(versions);
      
      expect(versions).toEqual(['2.0.0', '1.0.0']);
      expect(sorted).toEqual(['1.0.0', '2.0.0']);
    });

    it('should handle empty array', () => {
      const result = VersionUtils.sortVersionsAscending([]);
      expect(result).toEqual([]);
    });

    it('should handle single version', () => {
      const result = VersionUtils.sortVersionsAscending(['1.0.0']);
      expect(result).toEqual(['1.0.0']);
    });
  });

  describe('sortVersionsDescending', () => {
    it('should sort versions in descending order', () => {
      const versions = ['1.0.0', '2.0.0', '1.1.0', '1.2.0', '1.1.1'];
      const sorted = VersionUtils.sortVersionsDescending(versions);
      
      expect(sorted).toEqual(['2.0.0', '1.2.0', '1.1.1', '1.1.0', '1.0.0']);
    });

    it('should not modify original array', () => {
      const versions = ['1.0.0', '2.0.0'];
      const sorted = VersionUtils.sortVersionsDescending(versions);
      
      expect(versions).toEqual(['1.0.0', '2.0.0']);
      expect(sorted).toEqual(['2.0.0', '1.0.0']);
    });
  });

  describe('getLatestVersion', () => {
    it('should return the latest version from array', () => {
      const versions = ['1.0.0', '2.0.0', '1.5.0', '1.9.9'];
      const latest = VersionUtils.getLatestVersion(versions);
      
      expect(latest).toBe('2.0.0');
    });

    it('should return null for empty array', () => {
      const latest = VersionUtils.getLatestVersion([]);
      expect(latest).toBeNull();
    });

    it('should return single version from single-item array', () => {
      const latest = VersionUtils.getLatestVersion(['1.0.0']);
      expect(latest).toBe('1.0.0');
    });

    it('should handle complex version comparisons', () => {
      const versions = ['1.10.0', '1.2.0', '1.9.0', '2.0.0', '1.10.1'];
      const latest = VersionUtils.getLatestVersion(versions);
      
      expect(latest).toBe('2.0.0');
    });
  });

  describe('isValidSemanticVersion', () => {
    it('should return true for valid semantic versions', () => {
      expect(VersionUtils.isValidSemanticVersion('1.0.0')).toBe(true);
      expect(VersionUtils.isValidSemanticVersion('0.0.1')).toBe(true);
      expect(VersionUtils.isValidSemanticVersion('10.20.30')).toBe(true);
    });

    it('should return false for invalid semantic versions', () => {
      expect(VersionUtils.isValidSemanticVersion('1.0')).toBe(false);
      expect(VersionUtils.isValidSemanticVersion('1.0.0.0')).toBe(false);
      expect(VersionUtils.isValidSemanticVersion('v1.0.0')).toBe(false);
      expect(VersionUtils.isValidSemanticVersion('1.0.beta')).toBe(false);
      expect(VersionUtils.isValidSemanticVersion('1.0.0-alpha')).toBe(false);
    });
  });

  describe('getNextPatchVersion', () => {
    it('should increment patch version', () => {
      expect(VersionUtils.getNextPatchVersion('1.2.3')).toBe('1.2.4');
      expect(VersionUtils.getNextPatchVersion('1.2.9')).toBe('1.2.10');
      expect(VersionUtils.getNextPatchVersion('0.0.0')).toBe('0.0.1');
    });
  });

  describe('getNextMinorVersion', () => {
    it('should increment minor version and reset patch', () => {
      expect(VersionUtils.getNextMinorVersion('1.2.3')).toBe('1.3.0');
      expect(VersionUtils.getNextMinorVersion('1.9.5')).toBe('1.10.0');
      expect(VersionUtils.getNextMinorVersion('0.0.1')).toBe('0.1.0');
    });
  });

  describe('getNextMajorVersion', () => {
    it('should increment major version and reset minor and patch', () => {
      expect(VersionUtils.getNextMajorVersion('1.2.3')).toBe('2.0.0');
      expect(VersionUtils.getNextMajorVersion('9.5.1')).toBe('10.0.0');
      expect(VersionUtils.getNextMajorVersion('0.1.0')).toBe('1.0.0');
    });
  });
});