/**
 * Simple user profile class.
 */
class AnalysisProfile {
    constructor(dataSource, timePeriod, fields) {
        this.dataSource = dataSource || undefined;
        this.timePeriod = timePeriod || undefined;
        this.fields = fields || undefined;
    }
}

exports.AnalysisProfile = AnalysisProfile;
