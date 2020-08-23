using {
    redfig.plantmaint as my,
    sap.common
} from '../db/schema';

@path     : '/datasynch'
@impl     : './impl/synch-service'
@requires : 'authenticated-user'
service SynchService {
    // need a lot of actions here for various sync procedures

    entity DataSynchJob           as projection on my.DataSynchJob {
        *
    } actions {
        action runAll(synchMode :   Integer);
        action clearLog(clearMode : Integer);
    };

    entity DataSynchObjects       as projection on my.DataSynchObject {
        *
    } actions {
        action runSingle(ID : UUID, synchMode : Integer, objectID : UUID)
    };

    entity DataSynchLog           as projection on my.DataSynchLog {
        * , objectType.ID as ObjectTypeID, objectType.ServiceName as ServiceName, objectType.EntityName as EntityName, objectType.Direction as Direction, objectType.LastSynch as LastSynch, objectType.DataType as DataType, resolvedBy.ID as resolvedByID
    };

    //	Transactional Data
    entity Notifications          as projection on my.NotificationHeader {
        * , lastSynchLog.modifiedAt as LastSynch
    };

    entity NotificationItems      as projection on my.NotificationItem {
        *
    };

    entity NotificationActivities as projection on my.NotificationActivity {
        *
    };

    entity NotificationTexts      as projection on my.NotificationText {
        *
    };

    entity Orders                 as projection on my.OrderHeader {
        * , lastSynchLog.modifiedAt as LastSynch
    };

    entity OrderMovements         as projection on my.OrderMovement {
        *
    };

    entity OrderComponents        as projection on my.OrderComponent {
        *
    };

    entity OrderConfirmations     as projection on my.OrderConfirmation {
        *
    };

    entity OrderOperations        as projection on my.OrderOperation {
        *
    };

    //	Master Data
    entity Materials              as projection on my.Material {
        *
    };

    entity FunctionalLocations    as projection on my.FunctionalLocation {
        *
    };

    entity WorkCenters            as projection on my.WorkCenter {
        *
    };

    entity Equipments             as projection on my.Equipment {
        *
    };

    //	Config Data
    entity Plants                 as projection on my.Plant {
        *
    };

    entity StorageLocations       as projection on my.StorageLocation {
        *
    };

    entity NotificationTypes      as projection on my.NotificationType {
        *
    };

    entity OrderTypes             as projection on my.OrderType {
        *
    };

    entity PriorityTypes          as projection on my.PriorityType {
        *
    };

    entity PriorityCodes          as projection on my.PriorityCode {
        *
    };

    entity CodeGroups             as projection on my.CodeGroup {
        *
    };

    entity Codes                  as projection on my.Code {
        *
    };

};
