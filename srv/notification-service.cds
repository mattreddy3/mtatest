using {
    redfig.plantmaint as my,
    sap.common
} from '../db/schema';

@path     : '/notification'
@impl     : './impl/notification-service'
@requires : 'authenticated-user'
service NotificationService { // segw project
    entity Notifications         as projection on my.NotificationHeader { // segw entity
        * , equipment.ERPID as EquipmentID, equipment.EquipmentDesc as EquipmentDesc, functionalLocation.FunctionalLocationID as FunctionalLocationID, functionalLocation.FunctionalLocationDesc as FunctionalLocationDesc, notificationType.NotificationTypeID as NotificationTypeID, notificationType.NotificationTypeDesc as NotificationTypeDesc, workCenter.WorkCenterID as WorkCenterID, workCenter.WorkCenterDesc as WorkCenterDesc, priorityCode.PriorityCodeID as PriorityCodeID, priorityCode.PriorityDesc as PriorityDesc, createdUserInfo.DisplayName as CreatedByName, modifiedUserInfo.DisplayName as ModifiedByName
    } actions {
        action process(actionName : String(10))
    };

    entity NotificationItems     as projection on my.NotificationItem {
        * , notification.NotificationNo as NotificationNo, codeGroup.CodeGroupID as CodeGroupID, codeGroup.CodeGroupDesc as CodeGroupDesc, code.CodeID as CodeID, code.CodeDesc as CodeDesc,
    };

    entity NotificationActivitys as projection on my.NotificationActivity {
        * , notification.NotificationNo as NotificationNo, notificationItem.NotificationItemNo as NotificationItemNo, codeGroup.CodeGroupID as CodeGroupId, codeGroup.CodeGroupDesc as CodeGroupDesc, code.CodeID as CodeID, code.CodeDesc as CodeDesc,
    };

    entity NotificationTexts     as projection on my.NotificationText {
        * , createdUserInfo.DisplayName as User
    };

    entity ObjActions            as projection on my.ObjAction {
        *
    };

    entity UserInfo              as projection on my.UserInfo {
        *
    };

};
