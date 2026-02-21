  METHOD if_ex_exec_methodcall_ppf~execute.

    TYPES: BEGIN OF ty_doc_payload,
             documentId          TYPE string,
             businessObjectType  TYPE string,
             businessObjectId    TYPE string,
             sourceLocation      TYPE string,
             destinationLocation TYPE string,
             originalFileName    TYPE string,
             sourceSystem        TYPE string,
           END OF ty_doc_payload.
    TYPES tt_doc_payload TYPE STANDARD TABLE OF ty_doc_payload WITH EMPTY KEY.

    TYPES: BEGIN OF ty_batch_payload,
             documents TYPE tt_doc_payload,
           END OF ty_batch_payload.



    DATA :
      lo_appl_obj   TYPE REF TO /bofu/cl_ppf_container,
      lt_root_key   TYPE /bobf/t_frw_key,
      lo_srvmgr_tor TYPE REF TO /bobf/if_tra_service_manager,
      lo_srvmgr_cd  TYPE REF TO /bobf/if_tra_service_manager,
      lt_chg_hdr    TYPE        /bofu/t_cdc_change_hdr_k,
      lt_key_1      TYPE /bobf/t_frw_key,

      lo_http       TYPE REF TO if_http_client,

      lv_fo_id      TYPE string,
      lv_fo_type    TYPE string,
      lv_source_loc TYPE string,
      lv_dest_loc   TYPE string,
      lv_json       TYPE string,
      lv_status     TYPE i,
      lv_reason     TYPE string,
      lv_resp       TYPE string,
      lt_docs       TYPE tt_doc_payload.

    CONSTANTS lc_rfc_dest(13) TYPE c VALUE 'ZFIRESTORE-CS'.


    FIELD-SYMBOLS: <ls_root_any> TYPE any,
                   <ls_stop_any> TYPE any,
                   <lv_comp>     TYPE any.



    rp_status = 1.

    TRY.
        lo_appl_obj ?= io_appl_object.

      CATCH cx_os_object_not_found INTO DATA(lv_no_obj1).
        IF lv_no_obj1 IS BOUND.
          DATA(lv_err_msg) = lv_no_obj1->get_text( ).
          MESSAGE lv_err_msg TYPE 'S' DISPLAY LIKE 'E'.
          RETURN.
        ENDIF.
    ENDTRY.
    TRY.
* Get DB KEY using above object
        CALL METHOD lo_appl_obj->get_db_key
          RECEIVING
            result = DATA(lv_db_key).
      CATCH cx_os_object_not_found INTO lv_no_obj1.
        IF lv_no_obj1 IS BOUND.
          lv_err_msg = lv_no_obj1->get_text( ).
          MESSAGE lv_err_msg TYPE 'S' DISPLAY LIKE 'E'.
          RETURN.
        ENDIF.
    ENDTRY.

    APPEND INITIAL LINE TO lt_root_key ASSIGNING FIELD-SYMBOL(<lfs_root>).
    IF <lfs_root> IS ASSIGNED.
      <lfs_root>-key = lv_db_key.
    ENDIF.

** Call method to get TOR details
    IF lt_root_key IS NOT INITIAL.

      IF lo_srvmgr_tor IS NOT BOUND .
        lo_srvmgr_tor = /bobf/cl_tra_serv_mgr_factory=>get_service_manager(
                        iv_bo_key = /scmtms/if_tor_c=>sc_bo_key ).
      ENDIF.


      CALL METHOD /scmtms/cl_tor_helper_common=>get_tor_data
        EXPORTING
          it_root_key      = lt_root_key
        IMPORTING
          et_root          = DATA(lt_root)
          et_all_items     = DATA(lt_items)
          et_stop          = DATA(lt_stop)
          et_doc_reference = DATA(lt_doc_reference).
      IF lo_srvmgr_tor IS BOUND.

        SELECT DISTINCT
          ado~objid,
          ado~user_id_cr,
          ado~datetime_ch,
          ado~mimecode,
          ado~name,
          ado~alternative_name,
          ado~description,
          ado~attachment_type,
          art~att_schema,
          art~storage_category
          FROM /bobf/d_atf_do AS ado
          INNER JOIN /bobf/d_atf_rt   AS art ON ado~parent_key = art~db_key
          FOR ALL ENTRIES IN @lt_root_key
          WHERE art~host_key = @lt_root_key-key
          INTO TABLE @DATA(lt_result).
        IF sy-subrc EQ 0.


          "FO data from lt_root
          READ TABLE lt_root ASSIGNING <ls_root_any> INDEX 1.
          IF sy-subrc = 0 AND <ls_root_any> IS ASSIGNED.
            ASSIGN COMPONENT 'TOR_ID' OF STRUCTURE <ls_root_any> TO <lv_comp>.
            IF <lv_comp> IS ASSIGNED.
              lv_fo_id = <lv_comp>.
            ENDIF.

            ASSIGN COMPONENT 'TOR_TYPE' OF STRUCTURE <ls_root_any> TO <lv_comp>.
            IF <lv_comp> IS ASSIGNED.
              lv_fo_type = <lv_comp>.
            ENDIF.
          ENDIF.

          IF lv_fo_id IS INITIAL.
            lv_fo_id = lv_db_key.
          ENDIF.
          IF lv_fo_type IS INITIAL.
            lv_fo_type = '/SCMTMS/TOR'.
          ENDIF.

          "Source/Destination from first and last stop
          READ TABLE lt_stop ASSIGNING <ls_stop_any> INDEX 1.
          IF sy-subrc = 0 AND <ls_stop_any> IS ASSIGNED.
            ASSIGN COMPONENT 'LOG_LOCID' OF STRUCTURE <ls_stop_any> TO <lv_comp>.
            IF <lv_comp> IS ASSIGNED.
              lv_source_loc = <lv_comp>.
            ENDIF.
          ENDIF.

          READ TABLE lt_stop ASSIGNING <ls_stop_any> INDEX lines( lt_stop ).
          IF sy-subrc = 0 AND <ls_stop_any> IS ASSIGNED.
            ASSIGN COMPONENT 'LOG_LOCID' OF STRUCTURE <ls_stop_any> TO <lv_comp>.
            IF <lv_comp> IS ASSIGNED.
              lv_dest_loc = <lv_comp>.
            ENDIF.
          ENDIF.

          IF lv_source_loc IS INITIAL.
            lv_source_loc = 'unknown'.
          ENDIF.
          IF lv_dest_loc IS INITIAL.
            lv_dest_loc = 'unknown'.
          ENDIF.

          "Build documents[] in one go
          lt_docs = VALUE tt_doc_payload(
            FOR ls_att IN lt_result
            ( documentId          = CONV string( ls_att-objid )
              businessObjectType  = lv_fo_type
              businessObjectId    = lv_fo_id
              sourceLocation      = lv_source_loc
              destinationLocation = lv_dest_loc
              originalFileName    = COND string(
                                      WHEN ls_att-alternative_name IS NOT INITIAL THEN ls_att-alternative_name
                                      WHEN ls_att-name            IS NOT INITIAL THEN ls_att-name
                                      ELSE |{ ls_att-objid }.bin| )
              sourceSystem        = 'SAP' ) ).

          IF lt_docs IS NOT INITIAL.

            DATA(ls_batch) = VALUE ty_batch_payload( documents = lt_docs ).

            /ui2/cl_json=>serialize(
              EXPORTING
                data        = ls_batch
                pretty_name = /ui2/cl_json=>pretty_mode-none
              RECEIVING
                r_json      = lv_json ).

            TRY.


                cl_http_client=>create_by_destination(
                  EXPORTING
                    destination = lc_rfc_dest
                  IMPORTING
                    client      = lo_http ).

                lo_http->request->set_method( if_http_request=>co_request_method_post ).
                lo_http->request->set_header_field( name = 'Content-Type' value = 'application/json' ).
                lo_http->request->set_header_field( name = 'Accept'       value = 'application/json' ).
                lo_http->request->set_header_field( name = '~request_uri' value = 'sap/metadata' ).
                lo_http->request->set_cdata( lv_json ).

                lo_http->send( ).
                lo_http->receive( ).

                lo_http->response->get_status(
                  IMPORTING
                    code   = lv_status
                    reason = lv_reason ).

                lv_resp = lo_http->response->get_cdata( ).

                IF lv_status < 200 OR lv_status >= 300.
                  MESSAGE |Metadata batch failed HTTP { lv_status } { lv_reason }: { lv_resp }| TYPE 'S' DISPLAY LIKE 'E'.
                  rp_status = 0.
                ENDIF.

                lo_http->close( ).

              CATCH cx_root INTO DATA(lx_http).
                MESSAGE lx_http->get_text( ) TYPE 'S' DISPLAY LIKE 'E'.
            ENDTRY.

          ENDIF.


        ENDIF.




      ENDIF.

    ENDIF.


    RETURN.

  ENDMETHOD.