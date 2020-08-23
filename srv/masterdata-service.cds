using {
    redfig.plantmaint as my,
    sap.common
} from '../db/schema';

@path     : '/lookups'
@requires : 'authenticated-user'
service MasterDataService { // segw project
    //	Master Data
    @readonly
    entity Materials           as
        select from my.Material {
            *
        }
        where
            deletionInd = false;

    @readonly
    entity MaterialSLocs       as
        select from my.MaterialSLoc {
            *,
            material.MaterialNo                 as MaterialNo,
            plant.PlantID                       as PlantID,
            plant.PlantDesc                     as PlantDesc,
            storageLocation.StorageLocationID   as StorageLocationID,
            storageLocation.StorageLocationDesc as StorageLocationDesc
        }
        where
            deletionInd = false;

    @readonly
    entity FunctionalLocations as
        select from my.FunctionalLocation {
            *,
            parentFunctionalLocation.ID as ParentFunctionalLocationID,
        }
        where
            deletionInd = false;

    annotate FunctionalLocations with {
        HierarchyLevel             @sap.hierarchy.level.for       : 'ID';
        ID                         @sap.hierarchy.node.for        : 'ID';
        ParentFunctionalLocationID @sap.hierarchy.parent.node.for : 'ID';
    }

    @readonly
    entity WorkCenters         as
        select from my.WorkCenter {
            *
        }
        where
            deletionInd = false;

    @readonly
    entity Equipments          as
        select from my.Equipment {
            *,
            functionalLocation.FunctionalLocationID   as FunctionalLocationID,
            functionalLocation.FunctionalLocationDesc as FunctionalLocationDesc
        }
        where
            deletionInd = false;


    //	Config Data
    @readonly
    entity Plants              as
        select from my.Plant {
            *
        };

    @readonly
    entity StorageLocations    as
        select from my.StorageLocation {
            *
        };

    @readonly
    entity NotificationTypes   as
        select from my.NotificationType {
            *,
            codeGroups : redirected to CodeGroups
        }
        where
            deletionInd = false;

    @readonly
    entity OrderTypes          as
        select from my.OrderType {
            *
        }
        where
            deletionInd = false;

    @readonly
    entity PriorityTypes       as
        select from my.PriorityType {
            *
        }
        where
            deletionInd = false;

    @readonly
    entity PriorityCodes       as
        select from my.PriorityCode {
            *
        }
        where
            deletionInd = false;

    @readonly
    entity CodeGroups          as
        select from my.CodeGroup {
            *
        }
        where
            deletionInd = false;

    @readonly
    entity Codes               as
        select from my.Code {
            *,
            codeGroup : redirected to CodeGroups
        }
        where
            deletionInd = false;

    @readonly
    view ItemCodeGroups as
        select from my.CodeGroup {
            *
        }
        where
                Catalog     = 'C'
            and deletionInd = false;

    @readonly
    view ActivityCodeGroups as
        select from my.CodeGroup {
            *
        }
        where
                Catalog     = 'A'
            and deletionInd = false;
};
