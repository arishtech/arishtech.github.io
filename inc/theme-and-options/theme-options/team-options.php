<?php
//Team Page Options
CSF::createSection($restlyThemeOption, array(
    'title'  => esc_html__('Team Page', 'restly'),
    'icon'   => 'fa fa-users',
    'fields' => array(
        array(
            'id'       => 'restly_team_banner_enable',
            'type'     => 'switcher',
            'title'    => esc_html__('Enable Banner', 'restly'),
            'default'  => true,
            'text_on'  => esc_html__('Yes', 'restly'),
            'text_off' => esc_html__('No', 'restly'),
            'desc'     => esc_html__('Hide / Show Banner.', 'restly'),
        ),
        array(
            'id'         => 'restly_team_title',
            'type'       => 'text',
            'title'      => esc_html__('Banner Title', 'restly'),
            'default'    => esc_html('Team Details','restly'),
            'dependency' => array( 'restly_team_banner_enable', '==', 'true' ),
            'desc'       => esc_html__('Type team banner title here.', 'restly'),
        ),
    )
));