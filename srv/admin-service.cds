using {
    redfig.plantmaint as my,
    sap.common
} from '../db/schema';

@path     : '/admin'
@requires : 'uaa.user'
@impl     : './impl/admin-service'

service AdminService {
    entity Notifications as
        select from my.NotificationHeader {
            *
        };

    entity Plants        as
        select from my.Plant {
            *
        };

    entity TestCases     as
        select from my.TestCase {
            *
        } actions {
            action run(NotificationNo : String)
        };

};
